/** Image generation in the main process: stable-diffusion.cpp's sd-server, started on demand.
 * Everything the renderer can ask of it goes through the `sd:` channels registered here. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const sdBinaryManager = require("./sdBinaryManager.cjs");
const sdServer = require("./sdServer.cjs");
const imageModels = require("./imageModels.cjs");
const imageRequests = require("./imageRequests.cjs");
const imageFamilies = require("./imageFamilies.cjs");
// The shared logger, for timers and failures; `log` from deps is the same one but may be a stub in tests.
const { log: engineLog } = require("./logger.cjs");

const CREATED_IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/**
 * @param {import("electron").IpcMain} ipc
 * @param {object} deps what main.cjs owns: app, log, broadcast, wrap, platform, llamaProcess, modelStorage,
 *   huggingface, fileOps, fsGuard, rootsFor, announceChange, createdFilesDir, isInsideCreatedFilesDir, getSystemSpecs
 */
function register(ipc, deps) {
  const {
    app, log, broadcast, wrap, platform, llamaProcess, modelStorage, huggingface,
    fileOps, fsGuard, rootsFor, announceChange, createdFilesDir, isInsideCreatedFilesDir, getSystemSpecs,
  } = deps;

  /** A generated picture from the output folder, so chat history keeps a path and never the image's bytes. */
  function serveCreatedImage(name) {
    const type = CREATED_IMAGE_TYPES[path.extname(name).toLowerCase()];
    if (!type || name !== path.basename(name)) return new Response("Bad request", { status: 400 });

    const target = path.resolve(path.join(createdFilesDir(), name));
    if (!isInsideCreatedFilesDir(target) || !fs.existsSync(target)) return new Response("Not found", { status: 404 });

    const bytes = fs.readFileSync(target);
    return new Response(bytes, { headers: { "Content-Type": type, "Content-Length": String(bytes.length) } });
  }

  /** The one image setting the renderer holds: which model draws. */
  let imageSettings = { model: "" };

  // The engine lets go of its memory the moment the last queued picture is done.
  sdServer.setOptions({ idleTimeoutSec: 0 });

  const imageDir = () => imageModels.imageModelsDir(app.getPath("userData"));

  function firstInstalledImageModel() {
    return imageModels.listImageModels(imageDir()).find((entry) => entry.installed)?.id || "";
  }

  function chosenImageModel() {
    const listed = imageModels.listImageModels(imageDir());
    const wanted = listed.find((entry) => entry.id === imageSettings.model && entry.installed);
    return wanted ? wanted.id : firstInstalledImageModel();
  }

  function loadedChatModelGB() {
    const running = llamaProcess.getServerStatus();
    if (!running.running || !running.model) return 0;
    try {
      return fs.statSync(running.model).size / 1024 ** 3;
    } catch {
      return 0;
    }
  }

  /** The runner this machine should use, so an older install of another one is never preferred over it. */
  async function preferredImageRunner() {
    const specs = await getSystemSpecs();
    return sdBinaryManager.defaultRunner({ vramGB: specs?.vram || 0, nvidia: sdBinaryManager.hasNvidiaDriver() });
  }

  sdServer.configure(async () => {
    const specs = await getSystemSpecs();
    const found = sdBinaryManager.findSdBinary(app.getPath("userData"), await preferredImageRunner());
    const loras = imageModels.loraDir(app.getPath("userData"));
    return {
      binaryPath: found?.binaryPath || null,
      runner: found?.runner || "",
      env: found ? sdBinaryManager.engineEnv(found.binaryPath) : process.env,
      modelsDir: imageDir(),
      loraDir: fs.existsSync(loras) ? loras : null,
      defaultModel: chosenImageModel(),
      tmpDir: path.join(app.getPath("userData"), "tmp", "images"),
      log,
      // The chat engine loads its model again on the next message, so stopping it costs seconds.
      freeChatModel: () => llamaProcess.stopServerSync(),
      reloadChatModel: () => llamaProcess.reloadServer?.(),
      memory: async () => ({
        freeVramGB: specs?.unifiedMemory ? null : await platform.detectFreeVideoMemoryGB(),
        totalVramGB: specs?.vram || 0,
        loadedLlmGB: loadedChatModelGB(),
        unified: Boolean(specs?.unifiedMemory),
        freeRamGB: os.freemem() / 1024 ** 3,
        totalRamGB: os.totalmem() / 1024 ** 3,
      }),
    };
  });

  function imageProgress(payload) {
    broadcast("sd:progress", payload);
  }

  ipc.handle("sd:status", wrap("engine.image",async () => {
    const nvidia = sdBinaryManager.hasNvidiaDriver();
    const preferred = await preferredImageRunner();
    const found = sdBinaryManager.findSdBinary(app.getPath("userData"), preferred);
    const models = imageModels.listImageModels(imageDir());
    const model = chosenImageModel();
    return {
      success: true,
      release: sdBinaryManager.SD_CPP_RELEASE,
      installed: Boolean(found),
      runner: found?.runner || null,
      source: found?.source || null,
      runners: sdBinaryManager.runnersFor({ nvidia }),
      defaultRunner: preferred,
      model,
      models,
      ready: Boolean(found && model),
      server: sdServer.status(),
    };
  }));

  ipc.handle("sd:configure", wrap("engine.image",async (_event, next = {}) => {
    imageSettings = { model: typeof next.model === "string" ? next.model.slice(0, 300) : "" };
    return { success: true };
  }));

  ipc.handle("sd:setup-engine", wrap("engine.image",async () => {
    const specs = await getSystemSpecs();
    log.info("ipc", "sd:setup-engine requested");
    const timer = engineLog.time("engine.image", "engine setup", { vramGB: specs?.vram || 0 });
    // A different runner replaces the one running, so the old one must stop first.
    sdServer.stopSync();
    const result = await sdBinaryManager.ensureEngine(app.getPath("userData"), { vramGB: specs?.vram || 0 }, (progress) =>
      imageProgress({ status: "engine-download", ...progress }),
    );
    timer.end({ ready: Boolean(result.ready), runner: result.runner, kind: result.kind });
    return { success: Boolean(result.ready), runner: result.runner, kind: result.kind, error: result.error };
  }));

  /** Downloads each file of a model the catalogue names, and keeps it only if its hash is the pinned one. */
  async function downloadCatalogueModel(entry, reference) {
    const result = await imageModels.installCatalogueModel({
      entry,
      dir: imageDir(),
      download: (file, name, onProgress) =>
        modelStorage.downloadGgufModelForIpc({
          url: imageModels.fileUrl(file),
          modelsDir: imageDir(),
          filename: name,
          keepExtension: true,
          onProgress,
        }),
      onProgress: (progress) => imageProgress({ modelId: entry.id, reference, ...progress }),
    });
    if (result.code === "E_MODEL_HASH") log.error("engine.image", result.error);
    return result;
  }

  /** The files each download from the model list is writing, so the queue can cancel it by the name it shows. */
  const imageRepoDownloads = new Map();

  /** An image model found by searching Hugging Face: it goes in the image folder, never beside chat models. */
  ipc.handle("sd:download-repo", wrap("engine.image",async (_event, raw) => {
    const reference = String(raw || "");
    const resolved = await huggingface.resolveModelDownload(reference, { live: true });
    if (!resolved || resolved.parts) return { success: false, error: "That model cannot be downloaded as one file" };
    // A model Draggy knows comes with the encoder and VAE it needs, each checked against its pinned hash.
    const repo = String(reference || "").split(":")[0].toLowerCase();
    const known = imageModels.IMAGE_MODELS.find((entry) =>
      entry.files.some((file) => file.hfRepo.toLowerCase() === repo && file.filename === resolved.filename));
    // Anything else gets the encoders and VAE its family needs, found from the repository's name as much as the file's.
    const family = known ? null : imageFamilies.familyOf(reference, resolved.filename);
    const parts = imageFamilies.partsOf(family);
    imageRepoDownloads.set(reference, known
      ? known.files.map((file) => `${file.filename}${imageModels.UNVERIFIED}`)
      : [resolved.filename, ...parts.map((part) => `${part.filename}${imageModels.UNVERIFIED}`)]);
    try {
      if (known) return await downloadCatalogueModel(known, reference);
      const id = `file:${resolved.filename}`;
      const mainPath = path.join(imageDir(), resolved.filename);
      const mainSize = resolved.size || 0;
      const total = mainSize + parts.reduce((sum, part) => sum + part.size, 0);
      const report = (completed, remainingSeconds = null) => imageProgress({
        status: "model-download", modelId: id, reference, completed, total,
        percent: total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0, remainingSeconds,
      });

      // A model already here from an earlier try only needs what it was missing.
      const haveMain = mainSize > 0 && fs.existsSync(mainPath) && fs.statSync(mainPath).size === mainSize;
      if (!haveMain) {
        const result = await modelStorage.downloadGgufModelForIpc({
          url: resolved.url,
          modelsDir: imageDir(),
          filename: resolved.filename,
          keepExtension: true,
          onProgress: (progress) => report(progress.completed || 0, progress.remainingSeconds ?? null),
        });
        if (!result?.success) return result;
      }
      imageModels.recordFamily(imageDir(), resolved.filename, family?.id);

      if (parts.length > 0) {
        log.info("engine.image",`${resolved.filename} is ${family.id}; fetching ${parts.map((part) => part.filename).join(", ")}`);
        const result = await imageModels.installCatalogueModel({
          entry: { files: parts },
          dir: imageDir(),
          download: (file, name, onProgress) =>
            modelStorage.downloadGgufModelForIpc({ url: imageModels.fileUrl(file), modelsDir: imageDir(), filename: name, keepExtension: true, onProgress }),
          onProgress: (progress) => {
            if (progress.status === "model-download") report(mainSize + progress.completed, progress.remainingSeconds);
            else if (progress.status === "model-verify") imageProgress({ status: "model-verify", modelId: id, reference, total });
          },
        });
        if (result.code === "E_MODEL_HASH") log.error("engine.image", result.error);
        if (!result.success) return result;
      }
      imageProgress({ status: "model-done", modelId: id, reference });
      return { success: true };
    } finally {
      imageRepoDownloads.delete(reference);
    }
  }));

  ipc.handle("sd:cancel-download", wrap("engine.image",async (_event, id) => {
    const running = imageRepoDownloads.get(String(id || ""));
    if (running) {
      for (const name of running) await modelStorage.cancelDownloadGgufModel(imageDir(), name, true);
      return { success: true };
    }
    const entry = imageModels.catalogueEntry(String(id || ""));
    const names = entry
      ? entry.files.map((file) => `${file.filename}${imageModels.UNVERIFIED}`)
      : [path.basename(String(id || "").replace(/^file:/, ""))];
    for (const name of names) await modelStorage.cancelDownloadGgufModel(imageDir(), name, true);
    return { success: true };
  }));

  ipc.handle("sd:delete-model", wrap("engine.image",async (_event, id) => {
    if (String(id || "").startsWith("file:")) imageModels.recordFamily(imageDir(), path.basename(String(id).slice(5)), null);
    const wanted = String(id || "");
    const entry = imageModels.catalogueEntry(wanted);
    const names = entry
      ? entry.files.map((file) => file.filename)
      : wanted.startsWith("file:") && imageModels.isImageFileName(wanted.slice(5))
        ? [path.basename(wanted.slice(5))]
        : [];
    if (names.length === 0) return { success: false, error: "Unknown image model" };
    if (sdServer.status().model === wanted) sdServer.stopSync();
    log.info("engine.image",`Deleting image model ${wanted}: ${names.join(", ")}`);
    for (const name of names) fs.rmSync(path.join(imageDir(), name), { force: true });
    return { success: true };
  }));

  /** The starting image for image-to-image, read through the same containment as every other file tool. */
  function initImageFor(init) {
    if (!init) return { ok: true, dataUrl: null };
    if (init.kind === "attachment") return { ok: true, dataUrl: init.dataUrl };
    const read = fileOps.read(init.workspaceId, init.path);
    if (!read?.success || !read.isImage || !read.dataUrl) return { ok: false, error: read?.error || "That file is not an image" };
    return { ok: true, dataUrl: read.dataUrl };
  }

  /** Where a finished image goes: the output folder in Chat, the project through the file pipeline in Code. */
  async function saveGeneratedImage(request, tmpPath) {
    if (request.destination.kind === "project") {
      const { workspaceId, path: target, chatId } = request.destination;
      const mime = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[path.extname(target).toLowerCase()] || "image/png";
      const dataUrl = `data:${mime};base64,${fs.readFileSync(tmpPath).toString("base64")}`;
      const result = announceChange(workspaceId, fileOps.write(workspaceId, target, dataUrl, chatId));
      return result?.success
        ? { success: true, path: result.path, filename: path.basename(result.path), checkpointId: result.checkpointId, created: result.created }
        : { success: false, code: "E_SAVE", error: result?.error || "The image could not be saved" };
    }

    const dir = createdFilesDir();
    fs.mkdirSync(dir, { recursive: true });
    const name = imageRequests.outputName(request.prompt, (candidate) => fs.existsSync(path.join(dir, candidate)));
    const target = path.join(dir, name);
    fs.copyFileSync(tmpPath, target);
    return { success: true, path: target, filename: name, created: true };
  }

  ipc.handle("sd:generate", async (_event, raw) => {
    const checked = imageRequests.validateImageRequest(raw);
    if (!checked.ok) return { success: false, code: "E_REQUEST", error: checked.error };
    const request = checked.request;

    // Checked before minutes of work, so a refused path costs nothing.
    if (request.destination.kind === "project") {
      const { workspaceId, path: target, overwrite } = request.destination;
      const resolved = fsGuard.resolveWithin(rootsFor(workspaceId), target, { createParents: true });
      if (!resolved.ok) return { success: false, code: "E_PATH", error: resolved.error };
      if (!overwrite && fs.existsSync(resolved.path)) {
        return { success: false, code: "E_EXISTS", error: `${path.basename(resolved.path)} already exists`, params: { path: resolved.path } };
      }
    }

    const init = initImageFor(request.init);
    if (!init.ok) return { success: false, code: "E_INIT_IMAGE", error: init.error };

    const loras = imageModels.listLoras(imageModels.loraDir(app.getPath("userData")));
    const lora = [];
    for (const wanted of request.lora) {
      const match = loras.find((entry) => entry.name.toLowerCase() === wanted.name.toLowerCase());
      if (!match) return { success: false, code: "E_LORA", error: `There is no LoRA called ${wanted.name}`, params: { name: wanted.name } };
      lora.push({ path: match.file, multiplier: wanted.multiplier });
    }

    const format = { ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp" }[
      request.destination.kind === "project" ? path.extname(request.destination.path).toLowerCase() : ".png"
    ] || "png";

    log.info("engine.image", `sd:generate ${request.requestId}: ${request.prompt.length} characters, destination=${request.destination.kind}`);
    const timer = engineLog.time("engine.image", "generate", {
      id: request.requestId, cid: request.requestId, chars: request.prompt.length, steps: request.steps, size: `${request.width}x${request.height}`,
    });
    let tmpPath = null;
    try {
      const result = await sdServer.generate(
        request.requestId,
        {
          prompt: request.prompt,
          negativePrompt: request.negativePrompt,
          width: request.width,
          height: request.height,
          steps: request.steps,
          cfgScale: request.cfgScale,
          seed: request.seed,
          strength: request.strength,
          initImage: init.dataUrl,
          lora,
          hires: request.hires,
          fitModel: request.fitModel,
          model: request.model || undefined,
          outputFormat: format,
        },
        (progress) => imageProgress({ requestId: request.requestId, ...progress }),
      );
      tmpPath = result.tmpPath;
      const saved = await saveGeneratedImage(request, tmpPath);
      if (saved.success) timer.end({ status: "saved", width: result.width, height: result.height, model: result.model, seed: result.seed });
      else timer.fail(null, { code: saved.code, reason: String(saved.error ?? "").slice(0, 120) });
      if (!saved.success) return saved;
      imageProgress({ requestId: request.requestId, status: "done" });
      return { ...saved, width: result.width, height: result.height, seed: result.seed, model: result.model };
    } catch (error) {
      const code = error?.code || "E_FAILED";
      if (code === "E_CANCELLED") timer.end({ status: "cancelled" });
      else timer.fail(error, { code, reason: String(error?.message ?? "").slice(0, 120) });
      imageProgress({ requestId: request.requestId, status: code === "E_CANCELLED" ? "cancelled" : "error" });
      return { success: false, code, error: error?.message || "Image generation failed", params: error?.params || {} };
    } finally {
      if (tmpPath) fs.rmSync(tmpPath, { force: true });
    }
  });

  ipc.handle("sd:cancel", wrap("engine.image",async (_event, requestId) => ({
    success: await sdServer.cancel(String(requestId || "")),
  })));

  ipc.handle("sd:stop", wrap("engine.image",async () => {
    sdServer.stopSync();
    return { success: true };
  }));


  return {
    serveCreatedImage,
    stopSync: () => sdServer.stopSync(),
    /** The chat model asks for its memory back before it starts. True when the engine was stopped for it. */
    yieldToChat: () => sdServer.yieldToChat(),
  };
}

module.exports = { register };
