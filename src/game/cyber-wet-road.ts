import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { RoadPath, RoadPosition } from '../types';
import { nearestRoad, sampleRoad } from './road-network';

export function createCyberWetRoad(roads:RoadPath[]) {
  const reflector=new Reflector(new THREE.PlaneGeometry(1,1),{
    textureWidth:768,textureHeight:512,multisample:0,clipBias:.004,
    shader:{
      uniforms:{color:{value:new THREE.Color('#6c8391')},tDiffuse:{value:null},textureMatrix:{value:new THREE.Matrix4()},time:{value:0}},
      vertexShader:`uniform mat4 textureMatrix;varying vec4 vProject;varying vec3 vWorld;void main(){vProject=textureMatrix*vec4(position,1.);vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`uniform sampler2D tDiffuse;uniform float time;varying vec4 vProject;varying vec3 vWorld;
float wetHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float wetNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(wetHash(i),wetHash(i+vec2(1,0)),f.x),mix(wetHash(i+vec2(0,1)),wetHash(i+vec2(1,1)),f.x),f.y);}
void main(){vec2 uv=vProject.xy/vProject.w;vec2 p=vWorld.xz;float n=wetNoise(p*1.2);float puddle=smoothstep(.39,.8,wetNoise(p*.28)+wetNoise(p*1.5)*.2);uv+=(vec2(wetNoise(p*19.+time*.05),wetNoise(p.yx*24.))-.5)*.0009;vec3 reflected=texture2D(tDiffuse,uv).rgb*.38;for(int i=1;i<4;i++){float d=float(i)*(.00045+.0002*n);reflected+=texture2D(tDiffuse,uv+vec2(d*.4,d)).rgb*.1033;reflected+=texture2D(tDiffuse,uv-vec2(d*.4,d)).rgb*.1033;}float fresnel=pow(1.-abs(normalize(cameraPosition-vWorld).y),2.);gl_FragColor=vec4(reflected*.88,(.025+puddle*.39)*(.36+fresnel*.64));
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`
    }
  });
  reflector.name='赛博雨夜局部积水';
  reflector.rotation.x=-Math.PI/2;
  reflector.visible=false;
  const material=reflector.material as THREE.ShaderMaterial;
  material.transparent=true;material.depthWrite=false;
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
    dispose:()=>{reflector.removeFromParent();reflector.geometry.dispose();reflector.dispose();}
  };
}
