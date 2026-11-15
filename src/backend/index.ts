import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { registerConsole } from "./console.js";
import { InstanceLists } from "./list.js";
import { registerOperations } from "./operations.js";
import { registerRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  const lists = new InstanceLists(ctx);
  registerRoutes(ctx.http.router<Router>(), ctx, lists);
  registerConsole(ctx, lists);
  registerOperations(ctx, lists);
}

export async function deactivate() {}
