import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import type { Point3,RoadPath } from '../types';
import { createCyberCity } from './cyber-city';
import { createCyberAtmosphere } from './cyber-atmosphere';
import { styleCyberMaterials } from './cyber-materials';
import { createVehicleLighting } from './vehicle-lighting';

export function createCyberScene(renderer:THREE.WebGLRenderer,scene:THREE.Scene,roads:RoadPath[],spawn:Point3,sun:THREE.DirectionalLight){
  const previousSun={color:sun.color.clone(),intensity:sun.intensity,mapSize:sun.shadow.mapSize.clone()};
  const previousAutoReset=renderer.info.autoReset;
  renderer.info.autoReset=false;
  sun.color.set('#c0cbd4');sun.intensity=.72;
  sun.shadow.mapSize.set(2048,2048);
  const originalFill:{light:THREE.HemisphereLight;color:THREE.Color;ground:THREE.Color;intensity:number}[]=[];
  scene.traverse(object=>{
    if(!(object instanceof THREE.HemisphereLight))return;
    originalFill.push({light:object,color:object.color.clone(),ground:object.groundColor.clone(),intensity:object.intensity});
    object.color.set('#a2afba');object.groundColor.set('#343338');object.intensity=.46;
  });
  const materials=styleCyberMaterials(scene);
  const distant:{object:THREE.Object3D;visible:boolean;sphere:THREE.Sphere}[]=[];
  const seen=new Set<THREE.Object3D>();
  scene.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    const target=object.parent instanceof THREE.LOD?object.parent:object;
    if(seen.has(target))return;seen.add(target);
    if(object instanceof THREE.InstancedMesh){if(!object.boundingSphere)object.computeBoundingSphere();}
    else if(!object.geometry.boundingSphere)object.geometry.computeBoundingSphere();
    const bounds=object instanceof THREE.InstancedMesh?object.boundingSphere:object.geometry.boundingSphere;
    if(bounds)distant.push({object:target,visible:target.visible,sphere:bounds.clone().applyMatrix4(object.matrixWorld)});
  });
  const focus=new THREE.Vector3(spawn.x,spawn.y,spawn.z);
  const cullingFocus=new THREE.Vector3(Infinity,0,Infinity);
  const city=createCyberCity(roads,focus,materials.occupied);scene.add(city.group);
  const atmosphere=createCyberAtmosphere(renderer,scene,roads);scene.add(atmosphere.group);
  const vehicleLighting=createVehicleLighting(scene);
  const composer=new EffectComposer(renderer);
  const renderPass=new RenderPass(scene,new THREE.PerspectiveCamera());composer.addPass(renderPass);
  const size=renderer.getSize(new THREE.Vector2());
  const bloom=new UnrealBloomPass(size,.25,.57,1.28);composer.addPass(bloom);composer.addPass(new OutputPass());
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const film=new ShaderPass({
    uniforms:{tDiffuse:{value:null},time:{value:0},speedAmount:{value:0},grainStrength:{value:.0035},resolution:{value:new THREE.Vector2()}},
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`
uniform sampler2D tDiffuse;
uniform float time;
uniform float speedAmount;
uniform float grainStrength;
uniform vec2 resolution;
varying vec2 vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
  vec2 p=vUv*2.-1.;
  vec3 c=texture2D(tDiffuse,vUv).rgb;
  if(speedAmount>.001){
    vec2 radial=vUv-vec2(.5,.56);
    float radialDistance=length(radial*vec2(resolution.x/resolution.y,1.));
    float ground=1.-smoothstep(.16,.48,vUv.y);
    float player=smoothstep(.8,1.35,length((vUv-vec2(.5,.32))/vec2(.14,.22)));
    float scene=max(smoothstep(.15,.8,radialDistance),ground*.7)*player;
    float pixels=min(32.,speedAmount*32.)*scene;
    if(pixels>.01){
      vec2 direction=radial*resolution;
      vec2 trail=direction/max(length(direction),1.)*pixels/resolution;
      c*=.4;
      for(int i=1;i<=6;i++)c+=texture2D(tDiffuse,clamp(vUv-trail*float(i)/6.,vec2(.001),vec2(.999))).rgb*.1;
    }
  }
  float l=dot(c,vec3(.2126,.7152,.0722));
  c=mix(vec3(l),c,.95);
  float shadows=1.-smoothstep(.08,.5,l);
  float highlights=smoothstep(.55,.95,l);
  c*=mix(vec3(1.),vec3(.93,.995,1.055),shadows*.65);
  c*=mix(vec3(1.),vec3(1.04,1.012,.965),highlights*.65);
  c=(c-.4)*1.025+.4+vec3(.003,.004,.006)*shadows;
  c*=1.-dot(p*vec2(.65,.8),p*vec2(.65,.8))*.085;
  c+=(hash(gl_FragCoord.xy+fract(time)*713.)-.5)*grainStrength;
  gl_FragColor=vec4(max(c,vec3(0.)),1.);
}`
  });composer.addPass(film);
  const fxaa=new ShaderPass(FXAAShader);composer.addPass(fxaa);
  const resize=(width:number,height:number)=>{composer.setSize(width,height);const ratio=renderer.getPixelRatio();film.uniforms.resolution.value.set(width*ratio,height*ratio);fxaa.uniforms.resolution.value.set(1/(width*ratio),1/(height*ratio));};
  resize(size.x,size.y);
  let disposed=false;
  const dispose=()=>{
    if(disposed)return;disposed=true;
    window.removeEventListener('pagehide',pagehide);
    vehicleLighting.dispose();atmosphere.dispose();city.dispose();materials.dispose();sun.color.copy(previousSun.color);sun.intensity=previousSun.intensity;sun.shadow.mapSize.copy(previousSun.mapSize);
    distant.forEach(({object,visible})=>{object.visible=visible;});
    originalFill.forEach(({light,color,ground,intensity})=>{light.color.copy(color);light.groundColor.copy(ground);light.intensity=intensity;});
    composer.dispose();bloom.dispose();renderPass.dispose();film.dispose();fxaa.dispose();renderer.info.autoReset=previousAutoReset;
  };
  const pagehide=(event:PageTransitionEvent)=>{if(!event.persisted)dispose();};
  window.addEventListener('pagehide',pagehide);
  return {
    resize,dispose,
    render:(camera:THREE.Camera,time:number,position:Readonly<Point3>,heading:number,speed=0,lookBack=false)=>{
      focus.set(position.x,position.y,position.z);
      if(focus.distanceToSquared(cullingFocus)>32*32){
        cullingFocus.copy(focus);
        distant.forEach(({object,visible,sphere})=>{object.visible=visible&&sphere.center.distanceTo(focus)<sphere.radius+580;});
      }
      city.update(focus);atmosphere.update(time,focus,heading);vehicleLighting.update(time,camera,focus);film.uniforms.time.value=time;
      const velocity=Math.abs(speed);
      film.uniforms.speedAmount.value=reducedMotion.matches?0:(THREE.MathUtils.smoothstep(velocity,.5,4)*.2+THREE.MathUtils.smoothstep(velocity,4,55)*.8)*(lookBack?.25:1);
      film.uniforms.grainStrength.value=reducedMotion.matches?0:.0035;
      renderPass.camera=camera;renderer.info.reset();composer.render();
    }
  };
}
