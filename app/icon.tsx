import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#426f64",
          borderRadius: 112,
          color: "white",
          display: "flex",
          fontSize: 236,
          fontWeight: 700,
          height: "100%",
          justifyContent: "center",
          letterSpacing: "-0.08em",
          paddingRight: 20,
          width: "100%",
        }}
      >
        H
      </div>
    ),
    size,
  );
}
