// Marks node_modules as handled externally so electron-builder skips its
// built-in dependency collection entirely.
//
// The built-in collector spawns `npm list` over the repository root and
// intermittently hangs for 15-20 minutes on Windows CI runners (the
// packaging log freezes right after "searching for node modules"). A
// beforeBuild hook returning false makes electron-builder treat the
// dependencies as externally managed and skip the collector, while the
// production tree prepared by scripts/prepare-app-node-modules.mjs is
// injected through build.files ({ from: "build/app-prod/node_modules",
// to: "node_modules" }).
//
// TRAP: package.json must NOT set "npmRebuild": false — electron-builder
// 26.x short-circuits installAppDependencies before consulting this hook
// when it is (app-builder-lib packager.js:454-457), which silently leaves
// the collector enabled.
module.exports = () => false;
