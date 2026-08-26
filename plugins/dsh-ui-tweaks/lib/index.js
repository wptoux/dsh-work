//#region src/index.ts
/** Stable cordis plugin name. */
const name = "ui-tweaks";
/**
* Mount the host face. Deliberately a no-op: the plugin carries no host-side
* routes or services; future web-shell tweaks that need host support would
* extend this apply.
*/
function apply(_ctx) {}
//#endregion
export { apply, name };
