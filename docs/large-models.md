# Running models bigger than your memory

Draggy can run very large Mixture-of-Experts models on a computer that cannot hold them. It splits the model across three places: video memory (VRAM), system memory (RAM) and the drive. The always-used parts live in fast memory; the many rarely-used "experts" stay on disk and are read when needed.

## What runs

- **Models that fit** run on llama.cpp, as before.
- **Models that do not fit** run on colibri, a second engine Draggy downloads, checks and manages for you. On Windows, Draggy installs it with its own small Python runtime and never uses a Python you installed. On macOS and Linux it runs on the `python3` already on your computer.
- If your llama.cpp build supports expert streaming, Draggy uses that for models that nearly fit.

Open **Settings → Models → Large models**. Each model shows a three-part bar (VRAM, RAM, drive), a speed range, and a plain explanation of why.

## What speed to expect

Speed depends on how often the expert the model needs is already in memory (the hit rate) and how fast your drive reads.

- Expect roughly 0.3 to 3 tokens per second on a good NVMe drive, and less on a slow one. The panel shows a range, not a promise.
- Below 3 tokens per second Draggy switches to **slow mode**: fewer tool rounds per turn, thinking off unless you turn it on, and a notification when a long answer is ready while the window is in the background.
- After three measured replies, the range is replaced by what your computer actually did.

## Why drive speed matters

Every cache miss reads an expert from disk, so a drive that reads in random order at 3 GB/s is several times faster than one at 500 MB/s. A hard disk or a USB drive is usually too slow to be useful. Press **Measure disk** to test the drive; the result is cached.

## Adding a second drive

Put the model on the fastest drive you have. In the panel, choose the download location and pick the NVMe volume. The model needs its full size free there, plus a little headroom. Draggy refuses downloads that would fill the drive.

## Privacy

The expert-usage history is stored as counts only. The diagnostics report, saved with **Save report**, holds hardware, plans, speeds and the last 200 engine log lines. It never contains prompts or replies.

## When something goes wrong

| Symptom | What Draggy does |
| --- | --- |
| Drive full during download | Stops, keeps finished files, resumes later. |
| Smart App Control or antivirus blocks the engine | Reports it with the blocked file. Draggy never changes Windows security settings; allow the file yourself or use a different model. |
| Engine out of memory | Names the shortfall and suggests a smaller model or more free RAM. |
| Drive unplugged or engine exits | The model shows as stopped; start it again. |
| Computer sleeps | The engine restarts on demand after resume. |
