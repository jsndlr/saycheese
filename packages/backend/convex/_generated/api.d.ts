/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_images from "../actions/images.js";
import type * as auth from "../auth.js";
import type * as authComponent from "../authComponent.js";
import type * as commands_images from "../commands/images.js";
import type * as env from "../env.js";
import type * as functions from "../functions.js";
import type * as healthCheck from "../healthCheck.js";
import type * as http from "../http.js";
import type * as lib_storage from "../lib/storage.js";
import type * as queries_me from "../queries/me.js";
import type * as validators_index from "../validators/index.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/images": typeof actions_images;
  auth: typeof auth;
  authComponent: typeof authComponent;
  "commands/images": typeof commands_images;
  env: typeof env;
  functions: typeof functions;
  healthCheck: typeof healthCheck;
  http: typeof http;
  "lib/storage": typeof lib_storage;
  "queries/me": typeof queries_me;
  "validators/index": typeof validators_index;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
