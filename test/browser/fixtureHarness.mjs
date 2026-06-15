import { openDebugMapPage } from "./browserHarnessSupport.mjs";

export function defineBrowserFixture({
  artifact,
  family,
  id,
  label,
  mapName,
  maps,
  requirements = {},
  run,
}) {
  const requiredMaps = maps ?? (mapName ? [mapName] : []);
  return {
    id,
    label,
    artifact,
    family,
    requirements: {
      requiredMaps,
      requireRenderBundle: true,
      ...requirements,
    },
    run,
  };
}

export async function runDebugMapFixture({ browser, baseUrl, options, mapName, run }) {
  const { page, pageErrors } = await openDebugMapPage(browser, baseUrl, mapName, options);
  try {
    return await run({ page, pageErrors });
  } finally {
    await page.close();
  }
}

export function assertNoPageErrors(pageErrors, label = "Browser fixture") {
  if (pageErrors.length) {
    throw new Error(`${label} emitted console/page errors:\n${pageErrors.join("\n")}`);
  }
}

export function unique(values) {
  return [...new Set(values)].sort();
}
