import type { MeshStandardMaterial } from 'three';

export function addVergeVariation(material: MeshStandardMaterial) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vVergeWorld;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvVergeWorld = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vVergeWorld;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nfloat vergeField = sin(vVergeWorld.x * 0.019) * 0.42 + sin(vVergeWorld.y * 0.023 + 0.8) * 0.31 + sin((vVergeWorld.x + vVergeWorld.y) * 0.008) * 0.27;\nfloat dryGrass = smoothstep(-0.25, 0.78, vergeField);\ndiffuseColor.rgb *= mix(vec3(0.87, 0.99, 0.88), vec3(1.19, 1.02, 0.78), dryGrass);');
  };
  material.customProgramCacheKey = () => '路侧草地自然色差';
}
