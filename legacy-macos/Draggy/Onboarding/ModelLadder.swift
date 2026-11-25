import Foundation

/// One model the setup can offer, as a rung of win/src/modelRecommendations.ts.
struct ModelRung: Equatable, Sendable {
    enum Kind: Sendable { case dense, moe }

    /// A Hugging Face repository and quantisation, which is also what the downloader resolves.
    let reference: String
    let label: String
    let params: String
    /// The download, in gigabytes.
    let sizeGB: Double
    let kind: Kind
    /// All the memory it needs, in GB.
    let memory: Double
    /// Needs an engine build upstream does not ship yet, so it is never picked.
    var pending = false

    var sizeBytes: Int64 { Int64((sizeGB * 1e9).rounded()) }
}

/// The Windows model ladder and its Apple silicon rule: the best rung that fits in the memory macOS
/// lets the GPU wire, one higher on a Max or Ultra chip with the bandwidth for it.
enum ModelLadder {
    /// Unified memory macOS lets the GPU wire, leaving the rest to the system.
    static let usableUnifiedFraction = 0.75

    private static func dense(_ vram: Double, _ reference: String, _ label: String, _ params: String,
                              _ size: Double) -> ModelRung {
        ModelRung(reference: reference, label: label, params: params, sizeGB: size, kind: .dense, memory: vram)
    }

    private static func moe(_ memory: Double, _ reference: String, _ label: String, _ params: String,
                            _ size: Double, pending: Bool = false) -> ModelRung {
        ModelRung(reference: reference, label: label, params: params, sizeGB: size, kind: .moe, memory: memory,
                  pending: pending)
    }

    /// Ascending by quality, so the best rung that fits is the last one that does. Keep in step with Windows.
    static let rungs: [ModelRung] = [
        dense(1, "unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M", "Qwen 3.5 0.8B", "0.8B", 0.53),
        dense(2, "unsloth/Qwen3.5-2B-GGUF:Q4_K_M", "Qwen 3.5 2B", "2B", 1.28),
        dense(3.5, "unsloth/Qwen3.5-4B-GGUF:Q4_K_M", "Qwen 3.5 4B", "4B", 2.74),
        dense(6, "unsloth/gemma-4-E4B-it-GGUF:Q4_K_M", "Gemma 4 E4B", "4B", 4.98),
        dense(7.5, "unsloth/Qwen3.5-9B-GGUF:UD-Q4_K_XL", "Qwen 3.5 9B", "9B", 5.97),
        dense(9.5, "unsloth/gemma-4-12b-it-GGUF:UD-Q4_K_XL", "Gemma 4 12B", "12B", 7.37),
        dense(11, "mistralai/Ministral-3-14B-Instruct-2512-GGUF:Q4_K_M", "Ministral 3 14B", "14B", 8.24),
        moe(14, "ggml-org/gpt-oss-20b-GGUF:MXFP4", "GPT-OSS 20B", "20B MoE", 12.11),
        moe(19, "unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q4_K_XL", "Gemma 4 26B", "26B MoE", 17.01),
        moe(25, "unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_XL", "Qwen 3.6 35B", "35B MoE", 22.36),
        moe(30, "unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q5_K_XL", "Qwen 3.6 35B Q5", "35B MoE", 26.59),
        moe(33, "unsloth/Qwen3.6-35B-A3B-GGUF:Q6_K", "Qwen 3.6 35B Q6", "35B MoE", 29.31),
        moe(40, "unsloth/Qwen3.6-35B-A3B-GGUF:Q8_0", "Qwen 3.6 35B Q8", "35B MoE", 36.9),
        dense(15.5, "unsloth/Qwen3.8-27B-GGUF:UD-Q3_K_XL", "Qwen 3.8 27B Q3", "27B", 13.15),
        moe(61, "unsloth/Qwen3.5-122B-A10B-GGUF:UD-Q3_K_XL", "Qwen 3.5 122B Q3", "122B MoE", 56.97),
        moe(82, "unsloth/Qwen3.5-122B-A10B-GGUF:UD-Q4_K_XL", "Qwen 3.5 122B", "122B MoE", 77.03),
        dense(20, "unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL", "Qwen 3.8 27B", "27B", 17.56),
        dense(23, "unsloth/Qwen3.8-27B-GGUF:UD-Q5_K_XL", "Qwen 3.8 27B Q5", "27B", 20.88),
        dense(32, "unsloth/Qwen3.8-27B-GGUF:Q8_0", "Qwen 3.8 27B Q8", "27B", 29.05),
        moe(94, "unsloth/Qwen3.8-Flash-Next-GGUF:UD-Q3_K_XL", "Qwen 3.8 Flash-Next Q3", "125B MoE", 89.99),
        moe(116, "unsloth/Qwen3.8-Flash-Next-GGUF:UD-Q4_K_XL", "Qwen 3.8 Flash-Next", "125B MoE", 111.33),
        moe(135, "unsloth/DeepSeek-V4-Flash-GGUF:UD-Q3_K_XL", "DeepSeek V4 Flash Q3", "284B MoE", 129.45),
        moe(162, "unsloth/DeepSeek-V4-Flash-GGUF:UD-Q4_K_XL", "DeepSeek V4 Flash", "284B MoE", 155.1),
        moe(210, "unsloth/GLM-5.3-Flash-GGUF:UD-Q4_K_XL", "GLM-5.3-Flash", "320B MoE", 199.71),
        moe(250, "unsloth/GLM-5.3-Flash-GGUF:UD-Q5_K_XL", "GLM-5.3-Flash Q5", "320B MoE", 240.31),
        moe(410, "unsloth/DeepSeek-V4.1-Flash-1017-GGUF:UD-IQ3_XXS", "DeepSeek V4.1 Flash Q3", "552B MoE", 394.7,
            pending: true),
        moe(520, "unsloth/DeepSeek-V4.1-Flash-1017-GGUF:UD-Q4_K_XL", "DeepSeek V4.1 Flash", "552B MoE", 500.7,
            pending: true),
    ]

    enum ChipClass: Sendable { case base, pro, max, ultra }

    /// Reads "Apple M2 Pro" style names. Anything else counts as a base chip, which asks least of memory.
    static func chipClass(_ brand: String) -> ChipClass {
        let pattern = try? NSRegularExpression(pattern: "Apple\\s+M\\d+\\s*(Pro|Max|Ultra)?", options: .caseInsensitive)
        let range = NSRange(brand.startIndex..., in: brand)
        guard let match = pattern?.firstMatch(in: brand, range: range),
              let variant = Range(match.range(at: 1), in: brand).map({ brand[$0].lowercased() })
        else { return .base }
        switch variant {
        case "pro": return .pro
        case "max": return .max
        case "ultra": return .ultra
        default: return .base
        }
    }

    static func fits(_ rung: ModelRung, memoryGB: Double) -> Bool {
        rung.memory <= memoryGB * usableUnifiedFraction
    }

    /// The rung this Mac can carry, by its unified memory in GB and its chip name.
    static func recommended(memoryGB: Double, chip: String) -> ModelRung {
        guard let index = rungs.lastIndex(where: { !$0.pending && fits($0, memoryGB: memoryGB) }) else {
            return rungs[0]
        }
        let wide = [.max, .ultra].contains(chipClass(chip))
        if wide, rungs.indices.contains(index + 1) {
            let next = rungs[index + 1]
            if !next.pending, next.memory <= memoryGB { return next }
        }
        return rungs[index]
    }

    /// The pick and its two neighbours by memory: a lighter one and, when there is one, a stronger one.
    static func options(memoryGB: Double, chip: String) -> (lighter: ModelRung?, pick: ModelRung, stronger: ModelRung?) {
        let pick = recommended(memoryGB: memoryGB, chip: chip)
        let byMemory = rungs.filter { !$0.pending }.sorted { $0.memory < $1.memory }
        let at = byMemory.firstIndex(of: pick) ?? 0
        let lighter = at > 0 ? byMemory[at - 1] : nil
        let stronger = byMemory.indices.contains(at + 1) && byMemory[at + 1].memory <= memoryGB ? byMemory[at + 1] : nil
        return (lighter, pick, stronger)
    }
}
