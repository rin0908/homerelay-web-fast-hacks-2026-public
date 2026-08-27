import { FlaskConical } from "@/components/Icons";

export function DemoModeBanner() {
  return (
    <aside className="demo-banner" aria-label="合成デモモード">
      <FlaskConical aria-hidden="true" size={19} strokeWidth={1.9} />
      <span>
        <strong>合成デモモード</strong> — 架空データのみ。外部サービスには接続していません。
      </span>
    </aside>
  );
}
