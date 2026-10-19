import { bootstrapApplication, type BootstrapContext } from "@angular/platform-browser";
import { App } from "./app/app";
import { serverConfig } from "./app/app.config.server";

export default (context: BootstrapContext) => bootstrapApplication(App, serverConfig, context);
