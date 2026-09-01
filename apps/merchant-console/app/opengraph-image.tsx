import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "SELLABLE — Agentic Commerce Infrastructure";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#080808",
          padding: "36px 48px 32px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* subtle orange wash */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(680px 340px at 18% 18%, rgba(255,105,0,0.09), transparent 66%), radial-gradient(520px 320px at 92% 88%, rgba(255,105,0,0.05), transparent 60%)",
          }}
        />
        {/* hairline border */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "1px solid rgba(38,38,37,0.9)",
            pointerEvents: "none",
          }}
        />

        {/* top bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "relative",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: "#ff6900",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: "#080808",
                }}
              />
            </div>
            <span
              style={{
                fontSize: 13,
                letterSpacing: "0.18em",
                color: "#f5f5f3",
                fontFamily: "monospace",
                fontWeight: 600,
              }}
            >
              SELLABLE
            </span>
            <span
              style={{
                fontSize: 11,
                letterSpacing: "0.14em",
                color: "#51514d",
                fontFamily: "monospace",
              }}
            >
              · AGENTIC COMMERCE
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid #262625",
              background: "rgba(13,13,13,0.9)",
              padding: "7px 12px",
              borderRadius: 999,
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: "#10b981",
                boxShadow: "0 0 8px rgba(16,185,129,0.6)",
              }}
            />
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                color: "#a0a09c",
                fontFamily: "monospace",
              }}
            >
              LIVE · sellable.shop
            </span>
          </div>
        </div>

        {/* center */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            position: "relative",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span
              style={{
                fontSize: 112,
                fontWeight: 800,
                letterSpacing: "-0.06em",
                color: "#f5f5f3",
                lineHeight: 1,
                fontFamily: "Inter, Helvetica, Arial, sans-serif",
              }}
            >
              SELLABLE
            </span>
            <span
              style={{
                fontSize: 112,
                fontWeight: 800,
                color: "#ff6900",
                lineHeight: 1,
                marginLeft: 2,
              }}
            >
              .
            </span>
          </div>

          <div
            style={{
              fontSize: 13,
              letterSpacing: "0.2em",
              color: "#ff6900",
              fontFamily: "monospace",
              marginTop: -4,
            }}
          >
            AGENTIC COMMERCE INFRASTRUCTURE
          </div>

          <div
            style={{
              fontSize: 22,
              color: "#a0a09c",
              lineHeight: 1.35,
              maxWidth: 760,
              fontFamily: "Inter, Helvetica, Arial, sans-serif",
            }}
          >
            Agent proposes, policy disposes — every money action is audit-logged.
          </div>
        </div>

        {/* bottom */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            position: "relative",
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["EXPLAINABLE", "BOUNDED", "GATED", "AUDITABLE"].map((label) => (
              <div
                key={label}
                style={{
                  border: "1px solid #262625",
                  background: "#0d0d0d",
                  padding: "7px 10px",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  color: "#777772",
                  fontFamily: "monospace",
                }}
              >
                {label}
              </div>
            ))}
            <div
              style={{
                border: "1px solid rgba(255,105,0,0.22)",
                background: "rgba(255,105,0,0.09)",
                padding: "7px 10px",
                fontSize: 10,
                letterSpacing: "0.1em",
                color: "#ff6900",
                fontFamily: "monospace",
              }}
            >
              RAZORPAY TEST MODE
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 4,
            }}
          >
            <span
              style={{
                fontSize: 11,
                letterSpacing: "0.1em",
                color: "#f5f5f3",
                fontFamily: "monospace",
              }}
            >
              api.sellable.shop
            </span>
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.08em",
                color: "#51514d",
                fontFamily: "monospace",
              }}
            >
              AGENT · POLICY · LEDGER · RAZORPAY
            </span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
