import { createHash } from "node:crypto";
import { parse, parseDocument, stringify, isMap, isScalar, Scalar } from "yaml";
import { isHidden } from "./details.js";
import { INSTANCE_NAME } from "./settings.js";

// What a hidden value looks like in the editor. Sent back unchanged, it keeps
// the real value.
export const HIDDEN = "<hidden>";
export const MAX_YAML = 256 * 1024;

export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
// an image alias or fingerprint, with an optional remote: images:alpine/3.21
export const IMAGE =
  /^([a-z0-9][a-z0-9-]{0,62}:)?[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const CONFIG_KEY = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,127}$/;

export class ManageError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ManageError";
  }
}

export function versionOf(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function hideIn(map: unknown): void {
  if (!isMap(map)) return;
  for (const pair of map.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : "";
    if (isHidden(key) && pair.value !== null) {
      pair.value = new Scalar(HIDDEN) as never;
    }
  }
}

// The instance's own YAML with secret looking values replaced, and a version
// that changes whenever the real config does.
export function redactConfig(raw: string): { yaml: string; version: string } {
  const doc = parseDocument(raw);
  hideIn(doc.get("config"));
  const devices = doc.get("devices");
  if (isMap(devices)) {
    for (const pair of devices.items) hideIn(pair.value);
  }
  return { yaml: doc.toString(), version: versionOf(raw) };
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};

function checkKeys(map: Json, where: string): void {
  for (const key of Object.keys(map)) {
    if (!CONFIG_KEY.test(key))
      throw new ManageError(400, `Not a valid key in ${where}: ${key}`);
  }
}

function restore(edited: Json, current: Json, where: string): void {
  for (const [key, value] of Object.entries(edited)) {
    if (value !== HIDDEN) continue;
    if (!(key in current)) {
      throw new ManageError(
        400,
        `${where} ${key} is ${HIDDEN} but has no value to keep`,
      );
    }
    edited[key] = current[key];
  }
}

// The edited YAML with every untouched hidden value put back, ready for
// `incus config edit`. Refuses if the config changed since it was opened.
export function prepareEdit(
  editedYaml: string,
  version: string,
  currentRaw: string,
): string {
  if (editedYaml.length > MAX_YAML)
    throw new ManageError(400, "The config is too large");
  if (versionOf(currentRaw) !== version) {
    throw new ManageError(
      409,
      "The config changed since you opened it. Reload it and make your change again.",
    );
  }
  let edited: unknown;
  try {
    edited = parse(editedYaml);
  } catch (error) {
    throw new ManageError(400, `Not valid YAML: ${(error as Error).message}`);
  }
  if (!edited || typeof edited !== "object" || Array.isArray(edited)) {
    throw new ManageError(400, "The config must be a YAML mapping");
  }
  const current = obj(parse(currentRaw));
  const doc = edited as Json;

  const config = obj(doc.config);
  checkKeys(config, "config");
  restore(config, obj(current.config), "config");
  doc.config = config;

  const devices = obj(doc.devices);
  const currentDevices = obj(current.devices);
  for (const [name, raw] of Object.entries(devices)) {
    if (!CONFIG_KEY.test(name))
      throw new ManageError(400, `Not a valid device name: ${name}`);
    const device = obj(raw);
    checkKeys(device, `device ${name}`);
    restore(device, obj(currentDevices[name]), `device ${name}`);
    devices[name] = device;
  }
  doc.devices = devices;
  return stringify(doc);
}

// one hidden value, by config key or device and option
export function revealValue(
  currentRaw: string,
  key: string,
  device?: string,
): string {
  const current = obj(parse(currentRaw));
  const map = device ? obj(obj(current.devices)[device]) : obj(current.config);
  if (!isHidden(key) || !(key in map))
    throw new ManageError(400, "Nothing hidden by that name");
  return String(map[key]);
}

export function parseProfiles(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((p) => obj(p).name)
    .filter((n): n is string => typeof n === "string" && PROFILE_NAME.test(n))
    .sort();
}

export interface CreateRequest {
  project: string;
  name: string;
  image: string;
  profiles: string[];
  vm: boolean;
  start: boolean;
}

export function createWords(r: CreateRequest): string[] {
  if (!INSTANCE_NAME.test(r.name))
    throw new ManageError(400, "Not an instance name");
  if (!IMAGE.test(r.image)) throw new ManageError(400, "Not an image name");
  for (const p of r.profiles) {
    if (!PROFILE_NAME.test(p))
      throw new ManageError(400, `Not a profile name: ${p}`);
  }
  return [
    r.start ? "launch" : "create",
    "--project",
    r.project,
    ...(r.vm ? ["--vm"] : []),
    ...(r.profiles.length
      ? r.profiles.flatMap((p) => ["--profile", p])
      : ["--no-profiles"]),
    "--",
    r.image,
    r.name,
  ];
}
