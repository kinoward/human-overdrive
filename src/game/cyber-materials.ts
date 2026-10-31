import * as THREE from 'three';

export function styleCyberMaterials(scene:THREE.Scene) {
  const buildingMaterials=new Set<THREE.Material>();
  const occupied:THREE.Box3[]=[];
  const instance=new THREE.Matrix4(),matrix=new THREE.Matrix4(),bounds=new THREE.Box3(),size=new THREE.Vector3();
  scene.updateMatrixWorld(true);
  scene.traverse(object=>{
    if(!(object instanceof THREE.InstancedMesh))return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    if(!materials.some(material=>material.userData.airObstacle))return;
    object.geometry.computeBoundingBox();
    for(let i=0;i<object.count;i++){
      object.getMatrixAt(i,instance);matrix.multiplyMatrices(object.matrixWorld,instance);
      bounds.copy(object.geometry.boundingBox!).applyMatrix4(matrix);bounds.getSize(size);
      if(size.y>8&&Math.min(size.x,size.z)>7){occupied.push(bounds.clone());materials.forEach(material=>buildingMaterials.add(material));}
    }
  });
  const replacements=new Map<THREE.Material,THREE.Material>();
  const originals=new Map<THREE.Mesh,THREE.Material|THREE.Material[]>();
  const tint=new THREE.Color('#879ba9');
  const replace=(source:THREE.Material)=>{
    const existing=replacements.get(source);if(existing)return existing;
    if(!(source instanceof THREE.MeshStandardMaterial)){return source;}
    let material:THREE.MeshStandardMaterial;
    if(source.userData.roadSurface){
      material=new THREE.MeshPhysicalMaterial({
        color:source.color.clone().multiply(new THREE.Color('#aabcc8')),map:source.map,normalMap:source.normalMap,normalScale:source.normalScale.clone().multiplyScalar(.7),
        roughnessMap:source.roughnessMap,roughness:.43,metalness:.04,clearcoat:.85,clearcoatRoughness:.2,
        polygonOffset:source.polygonOffset,polygonOffsetFactor:source.polygonOffsetFactor,polygonOffsetUnits:source.polygonOffsetUnits
      });
      material.userData={...source.userData};
    }else{
      material=source.clone();material.onBeforeCompile=source.onBeforeCompile;material.customProgramCacheKey=source.customProgramCacheKey;
      material.color.multiply(tint);
      if(source.roughness<.6){material.roughness=Math.max(.18,source.roughness*.8);material.metalness=Math.max(material.metalness,.22);}
      if(source.map&&source.map.image instanceof HTMLCanvasElement&&!source.normalMap){material.emissiveMap=source.map;material.emissive.set('#7caaa9');material.emissiveIntensity=.28;}
    }
    if(buildingMaterials.has(source)){
      const base=material.onBeforeCompile;
      const cacheKey=material.customProgramCacheKey();
      material.onBeforeCompile=(shader,renderer)=>{
        base.call(material,shader,renderer);
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vCyberWorld;varying vec3 vCyberNormal;');
        shader.vertexShader=shader.vertexShader.replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\nvCyberNormal=inverseTransformDirection(transformedNormal,viewMatrix);');
        shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
vec4 cyberWorld=vec4(transformed,1.0);
#ifdef USE_INSTANCING
cyberWorld=instanceMatrix*cyberWorld;
#endif
vCyberWorld=(modelMatrix*cyberWorld).xyz;`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vCyberWorld;varying vec3 vCyberNormal;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
float cyberAxis=abs(vCyberNormal.x)>.65?vCyberWorld.z:vCyberWorld.x;
vec2 cyberCell=vec2(cyberAxis/2.9,vCyberWorld.y/3.25);
vec2 cyberUv=fract(cyberCell);
float cyberHash=fract(sin(dot(floor(cyberCell),vec2(12.9898,78.233)))*43758.5453);
float cyberWindow=smoothstep(.15,.19,cyberUv.x)*(1.-smoothstep(.76,.8,cyberUv.x))*smoothstep(.23,.27,cyberUv.y)*(1.-smoothstep(.76,.8,cyberUv.y));
cyberWindow*=step(.79,cyberHash)*(1.-smoothstep(.15,.42,abs(vCyberNormal.y)))*smoothstep(3.2,5.,vCyberWorld.y);
vec3 cyberLight=mix(vec3(.22,.62,.72),vec3(1.,.58,.25),step(.91,cyberHash));
totalEmissiveRadiance+=cyberLight*cyberWindow*.72;`);
      };
      material.customProgramCacheKey=()=>`${cacheKey}:赛博夜窗1`;
    }
    replacements.set(source,material);
    return material;
  };
  scene.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    originals.set(object,object.material);
    object.material=Array.isArray(object.material)?object.material.map(replace):replace(object.material);
  });
  return {
    occupied,
    dispose:()=>{originals.forEach((material,object)=>{object.material=material;});replacements.forEach((material,source)=>{if(material!==source)material.dispose();});}
  };
}
