// pack.mjs — compress a model for the web: meshopt (EXT_meshopt_compression),
// positions quantised to 16 bits (sub-millimetre on a 75 m aeroplane) and
// normals to 12 (no banding on a fuselage's curve). Decoded in the browser by
// three.js's own meshopt_decoder.js.
//
//   node pack.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
const [inp, out] = process.argv.slice(2);
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp);
await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 12 }));
await io.write(out, doc);
