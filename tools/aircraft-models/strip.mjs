// The A380 (CC-BY, Sketchfab): textures off, geometry kept whole.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
const [inp, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
for (const m of doc.getRoot().listMaterials()) { m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null); }
for (const t of doc.getRoot().listTextures()) t.dispose();
await MeshoptSimplifier.ready;
await doc.transform(flatten(), join(), weld(), dedup(), prune());
const a = doc.getRoot().getAsset(); a.extras = { ...(a.extras || {}), note: 'Textures removed for the crew centre.' };
await io.write(out, doc);
