import { createCatalogService } from "./catalog/catalog.js";

// Every Service by the name the transport knows it under. The platform passes
// the adapters: `fetchImpl` performs HTTP requests.
export function createServices({ fetchImpl }) {
  return {
    catalog: createCatalogService({ fetchImpl }),
  };
}
