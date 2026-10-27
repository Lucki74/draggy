import SwiftUI

public struct DiagnosticsView: View {
    @State private var probe = HardwareProbe.shared.probe()
    @State private var recommendation: ModelTierRecommendation?

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Diagnostics & Hardware")
                    .font(.title2)
                    .fontWeight(.bold)

                GroupBox("Hardware Specifications") {
                    VStack(alignment: .leading, spacing: 6) {
                        detailRow(label: "Processor", value: "\(probe.chip) (\(probe.cores) cores)")
                        detailRow(label: "Memory", value: "\(probe.ramGB) GB RAM")
                        detailRow(label: "OS Version", value: probe.osVersion)
                    }
                    .padding(6)
                }

                if let rec = recommendation {
                    GroupBox("Model Tier Recommendation") {
                        VStack(alignment: .leading, spacing: 6) {
                            detailRow(label: "Tier", value: rec.tierName)
                            detailRow(label: "Recommended Models", value: rec.recommendedParameterSize)
                            detailRow(label: "Quantization", value: rec.quantization)
                            detailRow(label: "Max Context", value: "\(rec.maxContext) tokens")
                        }
                        .padding(6)
                    }
                }

                Button("Export Diagnostics Bundle") {
                    let text = DiagnosticsBundle.shared.exportBundle()
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(text, forType: .string)
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(16)
        }
        .onAppear {
            recommendation = TierPlanner.shared.plan(for: probe)
        }
    }

    private func detailRow(label: String, value: String) -> some View {
        HStack {
            Text(label).font(.subheadline).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.subheadline).fontWeight(.medium)
        }
    }
}
