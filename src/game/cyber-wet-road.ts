import * as THREE from 'three';
import type { RoadPath, RoadPosition } from '../types';
import { nearestRoad, sampleRoad } from './road-network';

export function createCyberWetRoad(roads:RoadPath[]) {
  const material=new THREE.ShaderMaterial({
      uniforms:{time:{value:0}},transparent:true,depthWrite:false,
      vertexShader:`varying vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`uniform float time;varying vec3 vWorld;
float wetHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float wetNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(wetHash(i),wetHash(i+vec2(1,0)),f.x),mix(wetHash(i+vec2(0,1)),wetHash(i+vec2(1,1)),f.x),f.y);}
void main(){vec2 p=vWorld.xz;float puddle=smoothstep(.67,.88,wetNoise(p*.28)+wetNoise(p*1.5)*.12);float fresnel=pow(1.-abs(normalize(cameraPosition-vWorld).y),2.);float ripple=sin(length(fract(p*.8)-.5)*30.-time*2.)*.015;float fade=1.-smoothstep(90.,190.,distance(cameraPosition,vWorld));gl_FragColor=vec4(vec3(.12,.21,.27)+ripple,puddle*.11*fresnel*fade);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`
  });
  const reflector=new THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>(new THREE.PlaneGeometry(1,1),material);
  reflector.name='赛博雨夜局部积水';
  reflector.rotation.x=-Math.PI/2;
  reflector.visible=false;
  let lastX=Infinity,lastZ=Infinity,lastY=Infinity;
  let nearest:RoadPosition|null=null;
  const update=(time:number,focus:THREE.Vector3)=>{
    material.uniforms.time.value=time;
    const surfaceY=focus.y-.85;
    if(Math.hypot(focus.x-lastX,focus.z-lastZ)<17&&Math.abs(surfaceY-lastY)<.16)return nearest;
    lastX=focus.x;lastZ=focus.z;lastY=surfaceY;
    nearest=nearestRoad(roads,focus.x,focus.z,surfaceY);
    if(!nearest||Math.abs(nearest.direction.y)>.002||Math.abs(surfaceY-nearest.point.y)>3||Math.abs(nearest.offset)>nearest.road.width/2+1){reflector.visible=false;return nearest;}
    const planeY=nearest.point.y,positions:number[]=[],indices:number[]=[];
    const start=Math.max(0,nearest.distance-45),end=Math.min(nearest.road.length,nearest.distance+165);
    for(let distance=start;distance<end;distance+=5){
      const next=Math.min(end,distance+5);
      const samples=[sampleRoad(nearest.road,distance,-nearest.road.width/2),sampleRoad(nearest.road,distance,nearest.road.width/2),sampleRoad(nearest.road,next,-nearest.road.width/2),sampleRoad(nearest.road,next,nearest.road.width/2)];
      if(samples.some(sample=>Math.abs(sample.point.y-planeY)>.025))continue;
      const offset=positions.length/3;
      for(const sample of samples)positions.push(sample.point.x-focus.x,-(sample.point.z-focus.z),0);
      indices.push(offset,offset+2,offset+1,offset+1,offset+2,offset+3);
    }
    reflector.geometry.dispose();
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeBoundingSphere();
    reflector.geometry=geometry;reflector.position.set(focus.x,planeY+.044,focus.z);reflector.visible=indices.length>0;
    return nearest;
  };
  return {
    object:reflector,
    update,
    dispose:()=>{reflector.removeFromParent();reflector.geometry.dispose();material.dispose();}
  };
}
