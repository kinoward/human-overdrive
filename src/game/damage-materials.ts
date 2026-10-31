import * as THREE from 'three';

export class DamageMaterial {
  readonly material: THREE.MeshStandardMaterial;
  private points = Array.from({ length: 6 }, () => new THREE.Vector4());
  private directions = Array.from({ length: 6 }, () => new THREE.Vector4());
  private count = { value: 0 };

  constructor(source: THREE.Material, glass = false) {
    this.material = (source as THREE.MeshStandardMaterial).clone();
    this.material.transparent = false;
    this.material.opacity = 1;
    this.material.depthWrite = true;
    if (glass) this.material.roughness = 0.64;
    const sourceKey = source.customProgramCacheKey();
    this.material.customProgramCacheKey = () => `${sourceKey}:vehicle-damage-${glass ? 'glass' : 'paint'}-3`;
    this.material.onBeforeCompile = (shader, renderer) => {
      source.onBeforeCompile.call(this.material, shader, renderer);
      shader.uniforms.vehicleDamagePoints = { value: this.points };
      shader.uniforms.vehicleDamageDirections = { value: this.directions };
      shader.uniforms.vehicleDamageCount = this.count;
      shader.vertexShader = `varying vec3 vVehicleDamagePosition;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVehicleDamagePosition = position;');
      shader.fragmentShader = `varying vec3 vVehicleDamagePosition;
uniform vec4 vehicleDamagePoints[6];
uniform vec4 vehicleDamageDirections[6];
uniform int vehicleDamageCount;
${shader.fragmentShader}`.replace('#include <map_fragment>', `#include <map_fragment>
float vehicleWear = 0.0;
for (int damageIndex = 0; damageIndex < 6; damageIndex++) {
  if (damageIndex >= vehicleDamageCount) break;
  vec4 hit = vehicleDamagePoints[damageIndex];
  vec4 force = vehicleDamageDirections[damageIndex];
  vec3 delta = vVehicleDamagePosition - hit.xyz;
  float region = 1.0 - smoothstep(hit.w * 0.22, hit.w, length(delta));
  vec3 axisU = abs(force.y) > 0.8 ? vec3(1.0, 0.0, 0.0) : normalize(vec3(force.z, 0.0, -force.x));
  vec3 axisV = normalize(cross(force.xyz, axisU));
  vec2 surface = vec2(dot(delta, axisU), dot(delta, axisV));
  float wear = region * force.w;
  ${glass ? `
  float radius = length(surface) + 0.001;
  float angle = atan(surface.y, surface.x);
  float branch = abs(sin(angle * 6.5 + sin(radius * 31.0 + angle * 2.0) * 0.22));
  float branchWidth = 0.004 / (radius + 0.045);
  float spokes = 1.0 - smoothstep(branchWidth, branchWidth + max(fwidth(branch), 0.006), branch);
  float ring = abs(sin(radius * 39.0 + sin(angle * 4.0) * 0.65));
  float rings = 1.0 - smoothstep(0.012, 0.03 + fwidth(ring), ring);
  float brokenArc = step(0.16, sin(angle * 9.0 + radius * 11.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.016, 0.025, 0.031), wear * 0.86);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.63, 0.66), wear * max(spokes, rings * brokenArc * 0.3) * 0.84);
  ` : `
  float stripe = sin(surface.y * 145.0 + sin(surface.x * 17.0) * 0.7);
  float line = 1.0 - smoothstep(0.13, 0.13 + max(fwidth(stripe), 0.01), abs(stripe - 0.86));
  float grain = fract(sin(floor(surface.x * 28.0) * 127.1 + floor(surface.y * 90.0) * 311.7) * 43758.5453);
  float scuff = wear * (0.13 + line * step(0.3, grain) * 0.56);
  vec3 exposed = mix(vec3(0.034, 0.041, 0.046), vec3(0.31, 0.34, 0.35), step(0.56, grain));
  diffuseColor.rgb = mix(diffuseColor.rgb, exposed, scuff);
  `}
  vehicleWear = max(vehicleWear, wear);
}`).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, vehicleWear * 0.82);');
    };
  }

  add(point: THREE.Vector3, direction: THREE.Vector3, strength: number, radius: number) {
    let nearest = -1;
    let distance = Infinity;
    for (let index = 0; index < this.count.value; index++) {
      const hit = this.points[index];
      const candidate = Math.hypot(hit.x - point.x, hit.y - point.y, hit.z - point.z);
      if (candidate < distance) { distance = candidate; nearest = index }
    }
    if (nearest >= 0 && distance < radius * 0.65) {
      this.points[nearest].w = Math.max(this.points[nearest].w, radius);
      this.directions[nearest].w = Math.min(1, this.directions[nearest].w + strength * 0.35);
      return;
    }
    const index = this.count.value < 6 ? this.count.value++ : this.directions.reduce((weakest, value, current) => value.w < this.directions[weakest].w ? current : weakest, 0);
    const normal = direction.clone();
    if (normal.lengthSq() < 0.000001) normal.set(0, 1, 0);
    normal.normalize();
    this.points[index].set(point.x, point.y, point.z, radius);
    this.directions[index].set(normal.x, normal.y, normal.z, Math.min(1, strength));
  }

  dispose() { this.material.dispose() }
}
