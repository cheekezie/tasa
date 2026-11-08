import { BRAND } from "@/config/brand";

export const RouteFallback = () => (
  <div className="app-loader" role="status" aria-label={`Loading ${BRAND.product}`}>
    <img src={BRAND.iconUrl} alt="" className="app-loader__logo" />
    <div className="app-loader__spinner" aria-hidden="true" />
    <span className="sr-only">Loading {BRAND.product}…</span>
  </div>
);
