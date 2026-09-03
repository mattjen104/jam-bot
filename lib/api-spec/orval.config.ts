import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const isIsolatedRun = process.env.API_CODEGEN_ISOLATED === "1";
const isCoordinatedRun = process.env.API_CODEGEN_COORDINATED === "1";

if (!isIsolatedRun && !isCoordinatedRun) {
  throw new Error(
    "[api-codegen-coordination] Refusing to run Orval without coordination. " +
      "Use `pnpm --filter @workspace/api-spec run codegen`, or use the " +
      "isolated reproducibility checker.",
  );
}

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
          },
        },
        // HTTP JSON transports date-time values as ISO strings. Keep the
        // runtime schemas aligned with that wire representation so callers
        // can validate fetched responses without reviving dates first.
        useDates: false,
      },
    },
  },
});
