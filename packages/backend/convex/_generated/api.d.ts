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
import type * as actions_scoring from "../actions/scoring.js";
import type * as auth from "../auth.js";
import type * as authComponent from "../authComponent.js";
import type * as commands_images from "../commands/images.js";
import type * as crons from "../crons.js";
import type * as env from "../env.js";
import type * as functions from "../functions.js";
import type * as healthCheck from "../healthCheck.js";
import type * as http from "../http.js";
import type * as internal_images from "../internal/images.js";
import type * as internal_scoring from "../internal/scoring.js";
import type * as internal_seed from "../internal/seed.js";
import type * as internal_seedData from "../internal/seedData.js";
import type * as internal_storageSweep from "../internal/storageSweep.js";
import type * as internal_stuckImages from "../internal/stuckImages.js";
import type * as lib_imageEncoding from "../lib/imageEncoding.js";
import type * as lib_imageValidation from "../lib/imageValidation.js";
import type * as lib_providerImage from "../lib/providerImage.js";
import type * as lib_providers_index from "../lib/providers/index.js";
import type * as lib_providers_rekognition from "../lib/providers/rekognition.js";
import type * as lib_providers_stub from "../lib/providers/stub.js";
import type * as lib_providers_types from "../lib/providers/types.js";
import type * as lib_scoringPolicy from "../lib/scoringPolicy.js";
import type * as lib_scoringPool from "../lib/scoringPool.js";
import type * as lib_seedGuard from "../lib/seedGuard.js";
import type * as lib_storage from "../lib/storage.js";
import type * as model_images from "../model/images.js";
import type * as model_seed from "../model/seed.js";
import type * as queries_images from "../queries/images.js";
import type * as queries_me from "../queries/me.js";
import type * as validators_index from "../validators/index.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/images": typeof actions_images;
  "actions/scoring": typeof actions_scoring;
  auth: typeof auth;
  authComponent: typeof authComponent;
  "commands/images": typeof commands_images;
  crons: typeof crons;
  env: typeof env;
  functions: typeof functions;
  healthCheck: typeof healthCheck;
  http: typeof http;
  "internal/images": typeof internal_images;
  "internal/scoring": typeof internal_scoring;
  "internal/seed": typeof internal_seed;
  "internal/seedData": typeof internal_seedData;
  "internal/storageSweep": typeof internal_storageSweep;
  "internal/stuckImages": typeof internal_stuckImages;
  "lib/imageEncoding": typeof lib_imageEncoding;
  "lib/imageValidation": typeof lib_imageValidation;
  "lib/providerImage": typeof lib_providerImage;
  "lib/providers/index": typeof lib_providers_index;
  "lib/providers/rekognition": typeof lib_providers_rekognition;
  "lib/providers/stub": typeof lib_providers_stub;
  "lib/providers/types": typeof lib_providers_types;
  "lib/scoringPolicy": typeof lib_scoringPolicy;
  "lib/scoringPool": typeof lib_scoringPool;
  "lib/seedGuard": typeof lib_seedGuard;
  "lib/storage": typeof lib_storage;
  "model/images": typeof model_images;
  "model/seed": typeof model_seed;
  "queries/images": typeof queries_images;
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
  scoringPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"scoringPool">;
};
