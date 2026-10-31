import * as THREE from 'three';

const surfaceVertex = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vUv = uv;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const illumination = `
float daylight(float mu) {
  float edge = 0.275637;
  if (mu <= -edge) return 0.045;
  if (mu >= edge) return 0.11 + 0.89 * mu;
  float t = (mu + edge) / (2.0 * edge);
  float t2 = t * t;
  float t3 = t2 * t;
  return (2.0 * t3 - 3.0 * t2 + 1.0) * 0.045
    + (-2.0 * t3 + 3.0 * t2) * (0.11 + 0.89 * edge)
    + (t3 - t2) * 2.0 * edge * 0.89;
}`;

export function globeMaterials(textures: Record<'day' | 'night' | 'clouds' | 'surface', THREE.Texture>) {
  const sun = { value: new THREE.Vector3(-0.65, 0.35, 0.68).normalize() };
  const earth = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: textures.day },
      nightMap: { value: textures.night },
      cloudMap: { value: textures.clouds },
      surfaceMap: { value: textures.surface },
      sunDirection: sun,
    },
    vertexShader: surfaceVertex,
    fragmentShader: `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D cloudMap;
uniform sampler2D surfaceMap;
uniform vec3 sunDirection;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
${illumination}
void main() {
  vec3 normal = normalize(vNormal);
  vec3 view = normalize(cameraPosition - vPosition);
  float mu = dot(normal, sunDirection);
  vec3 albedo = texture2D(dayMap, vUv).rgb;
  vec2 surface = texture2D(surfaceMap, vUv).rg;
  float clouds = texture2D(cloudMap, vUv + vec2(-0.0011, 0.0007)).r;
  vec3 color = albedo * daylight(mu) * (1.0 - clouds * 0.17);
  float specular = pow(max(dot(normal, normalize(view + sunDirection)), 0.0), 70.0);
  color += vec3(0.55, 0.68, 0.85) * specular * surface.r * max(mu, 0.0) * 0.12;
  vec3 night = texture2D(nightMap, vUv).rgb;
  vec3 lights = max(night - vec3(night.b * 0.85 + 0.003), vec3(0.0));
  float nightfall = 1.0 - smoothstep(-0.139173, 0.034899, mu);
  color += lights * nightfall * 1.3 * (1.0 - clouds * 0.65);
  float limb = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
  float air = limb * smoothstep(-0.18, 0.45, mu) * 0.24;
  color = mix(color, vec3(0.49, 0.65, 0.84), air);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const clouds = new THREE.ShaderMaterial({
    uniforms: { cloudMap: { value: textures.clouds }, sunDirection: sun },
    transparent: true,
    depthWrite: false,
    vertexShader: surfaceVertex,
    fragmentShader: `
uniform sampler2D cloudMap;
uniform vec3 sunDirection;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
${illumination}
void main() {
  float density = texture2D(cloudMap, vUv).r * 0.85;
  if (density < 0.008) discard;
  float mu = dot(normalize(vNormal), sunDirection);
  vec3 tint = mix(vec3(0.64, 0.73, 0.88), vec3(1.0, 0.97, 0.92), smoothstep(-0.08, 0.4, mu));
  vec3 color = tint * (daylight(mu) * 1.2 + 0.015);
  gl_FragColor = vec4(color, density);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const atmosphere = new THREE.ShaderMaterial({
    uniforms: { sunDirection: sun },
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    vertexShader: surfaceVertex,
    fragmentShader: `
uniform vec3 sunDirection;
varying vec3 vPosition;
void main() {
  vec3 origin = cameraPosition;
  vec3 ray = normalize(vPosition - origin);
  float b = dot(origin, ray);
  float c = dot(origin, origin);
  float outer = sqrt(max(b * b - c + 1.1 * 1.1, 0.0));
  float start = max(0.0, -b - outer);
  float end = -b + outer;
  float ground = b * b - c + 1.05 * 1.05;
  if (ground > 0.0) end = min(end, -b - sqrt(ground));
  float stepLength = max(end - start, 0.0) / 8.0;
  float optical = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 point = origin + ray * (start + (float(i) + 0.5) * stepLength);
    float radius = length(point);
    float height = max(radius - 1.05, 0.0);
    float horizon = -sqrt(max(1.0 - pow(1.05 / radius, 2.0), 0.0));
    float light = smoothstep(horizon - 0.025, horizon + 0.16, dot(point / radius, sunDirection));
    optical += exp(-height / 0.009) * light * stepLength;
  }
  float alpha = (1.0 - exp(-optical * 18.0)) * 0.72;
  gl_FragColor = vec4(vec3(0.80, 0.87, 1.0) * 0.85, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  return { earth, clouds, atmosphere };
}
