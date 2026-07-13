import { renderSVG } from "uqr";

export function QrLink({ url, label }: { url: string; label: string }) {
  const svg = renderSVG(url, {
    blackColor: "oklch(0.92 0.005 260)",
    whiteColor: "transparent",
  });

  return (
    <figure className="inline-block">
      <div
        className="h-32 w-32"
        // uqr emits a static, self-generated SVG string for the given URL.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="mt-2 text-xs text-chalk-dim">{label}</figcaption>
    </figure>
  );
}
