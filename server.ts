// bb-plugin-rad-binder — backend entry.
//
// The theme is declarative: `bb.themes` in package.json points bb at
// theme.css, which bb reads straight from the plugin directory. `bb.server`
// is a required manifest field, so this factory only satisfies the loader.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded — contributes the Rad Binder theme");
}
