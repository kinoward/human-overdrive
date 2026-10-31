import * as THREE from 'three';
import type { RoadPath, RoadPosition } from '../types';
import { RoadIndex, sampleRoad } from './road-network';
import { createCyberWetRoad } from './cyber-wet-road';

export function createCyberAtmosphere(renderer:THREE.WebGLRenderer,scene:THREE.Scene,roads:RoadPath[]) {
  const previous={background:scene.background,fog:scene.fog,environment:scene.environment,environmentIntensity:scene.environmentIntensity,backgroundIntensity:scene.backgroundIntensity,backgroundBlurriness:scene.backgroundBlurriness};
  const group=new THREE.Group();group.name='赛博雨夜氛围';
  const background=new THREE.Color('#101b28'),fog=new THREE.FogExp2('#172b3b',.0029);
  scene.background=background;scene.fog=fog;scene.backgroundIntensity=1;scene.backgroundBlurriness=0;
  const environment=new THREE.Scene();environment.background=new THREE.Color('#263a48');
  const panel=(color:string,intensity:number,x:number,y:number,z:number,width:number,height:number)=>{
    const material=new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(intensity),side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);mesh.position.set(x,y,z);mesh.lookAt(0,0,0);environment.add(mesh);
  };
  panel('#b6dced',1.45,-18,16,0,14,27);
  panel('#efb48b',1.05,18,7,-8,10,17);
  panel('#dce9ec',1.6,0,25,0,26,15);
  panel('#5dc2d7',.8,0,6,-24,16,14);
  const pmrem=new THREE.PMREMGenerator(renderer),environmentTarget=pmrem.fromScene(environment,.13,.1,100);
  scene.environment=environmentTarget.texture;scene.environmentIntensity=.5;
  environment.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();(object.material as THREE.Material).dispose();}});pmrem.dispose();
  group.add(new THREE.HemisphereLight('#b6c3cc','#3a3836',.56));
  const wetRoad=createCyberWetRoad(roads);group.add(wetRoad.object);
  let seed=47293;
  const random=()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296;
  const rainGroup=new THREE.Group();group.add(rainGroup);
  const rainCount=3000,positions=new Float32Array(rainCount*6),phases=new Float32Array(rainCount*2),tips=new Float32Array(rainCount*2);
  for(let i=0;i<rainCount;i++){
    const x=(random()-.5)*84,y=random()*48,z=42-random()*300,phase=random();
    for(let tip=0;tip<2;tip++){const index=i*6+tip*3;positions[index]=x;positions[index+1]=y;positions[index+2]=z;phases[i*2+tip]=phase;tips[i*2+tip]=tip;}
  }
  const rainGeometry=new THREE.BufferGeometry();rainGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));rainGeometry.setAttribute('phase',new THREE.BufferAttribute(phases,1));rainGeometry.setAttribute('tip',new THREE.BufferAttribute(tips,1));
  const rainMaterial=new THREE.ShaderMaterial({
    uniforms:{time:{value:0}},transparent:true,depthWrite:false,
    vertexShader:`uniform float time;attribute float phase;attribute float tip;varying float vAlpha;void main(){vec3 p=position;p.y=mod(p.y-time*(18.+phase*10.),48.)+tip*(.28+phase*.38);p.x+=p.y*.06;vec4 mv=modelViewMatrix*vec4(p,1.);vAlpha=(.025+phase*.09)*exp(-length(mv.xyz)*.005);gl_Position=projectionMatrix*mv;}`,
    fragmentShader:`varying float vAlpha;void main(){gl_FragColor=vec4(.5,.7,.81,vAlpha);}`
  });
  const rain=new THREE.LineSegments(rainGeometry,rainMaterial);rain.frustumCulled=false;rainGroup.add(rain);
  const steamGeometry=new THREE.PlaneGeometry(3.3,4.8);
  const steamMaterial=new THREE.ShaderMaterial({
    uniforms:{time:{value:0}},transparent:true,depthWrite:false,side:THREE.DoubleSide,
    vertexShader:`varying vec2 vUv;varying float vDistance;void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.);vDistance=length(mv.xyz);gl_Position=projectionMatrix*mv;}`,
    fragmentShader:`uniform float time;varying vec2 vUv;varying float vDistance;float mistHash(vec2 p){return fract(sin(dot(p,vec2(41.31,289.7)))*42758.5453);}float mistNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mistHash(i),mistHash(i+vec2(1,0)),f.x),mix(mistHash(i+vec2(0,1)),mistHash(i+vec2(1,1)),f.x),f.y);}void main(){vec2 p=vUv*vec2(3.,4.)-vec2(sin(time*.3)*.3,time*.29);float n=mistNoise(p)*.65+mistNoise(p*2.1)*.35;float shape=pow(max(0.,1.-abs(vUv.x-.5)*2.),2.)*sin(vUv.y*3.14159);float a=shape*smoothstep(.22,.85,n)*.2*exp(-vDistance*.003);gl_FragColor=vec4(.4,.56,.65,a);}`
  });
  const steams=Array.from({length:4},()=>{const mesh=new THREE.Mesh(steamGeometry,steamMaterial);group.add(mesh);return mesh;});
  const splashCount=80,splashGeometry=new THREE.PlaneGeometry(1,1),splashPhases=new Float32Array(splashCount);
  const splashOffsets=Array.from({length:splashCount},(_,index)=>{splashPhases[index]=random();return {distance:random()*190-24,lateral:(random()-.5)*.86,scale:.25+random()*.65};});
  splashGeometry.setAttribute('phase',new THREE.InstancedBufferAttribute(splashPhases,1));
  const splashMaterial=new THREE.ShaderMaterial({
    uniforms:{time:{value:0}},transparent:true,depthWrite:false,side:THREE.DoubleSide,
    vertexShader:`uniform float time;attribute float phase;varying vec2 vUv;varying float vAge;void main(){vUv=uv;vAge=fract(time*.72+phase);gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec2 vUv;varying float vAge;void main(){float d=length(vUv-.5);float ring=1.-smoothstep(.005,.02,abs(d-vAge*.46));gl_FragColor=vec4(.43,.63,.7,ring*pow(1.-vAge,2.)*.09);}`
  });
  const splashes=new THREE.InstancedMesh(splashGeometry,splashMaterial,splashCount);splashes.frustumCulled=false;group.add(splashes);
  type LampSite={position:THREE.Vector3;road:RoadPath};
  const roadIndex=new RoadIndex(roads),lampCells=new Map<string,LampSite[]>();
  for(const road of roads)for(let distance=40;distance<road.length-10;distance+=road.kind==='main'?48:70){
    const pole=sampleRoad(road,distance,road.width/2+1.7);
    if(roadIndex.covers(pole.point,road,.5))continue;
    const head=sampleRoad(road,distance,road.width/2-1).point;
    const site={position:new THREE.Vector3(head.x,head.y+8.77,head.z),road},key=`${Math.floor(head.x/100)},${Math.floor(head.z/100)}`;
    if(!lampCells.has(key))lampCells.set(key,[]);
    lampCells.get(key)!.push(site);
  }
  const lights=Array.from({length:4},()=>{const light=new THREE.PointLight('#ffdfb5',0,56,2);group.add(light);return {light,site:null as LampSite|null};});
  let lastTime:number|null=null;
  const updateLights=(time:number,focus:THREE.Vector3,nearest:RoadPosition|null)=>{
    const delta=lastTime===null?1/60:THREE.MathUtils.clamp(time-lastTime,0,.1),blend=1-Math.exp(-delta*9);
    lastTime=time;
    const cx=Math.floor(focus.x/100),cz=Math.floor(focus.z/100),sites:LampSite[]=[];
    for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)for(const site of lampCells.get(`${x},${z}`)??[]){
      if((site.road===nearest?.road||Math.abs(site.position.y-8.77-(nearest?.point.y??focus.y))<3)&&site.position.distanceToSquared(focus)<10000)sites.push(site);
    }
    sites.sort((a,b)=>a.position.distanceToSquared(focus)-b.position.distanceToSquared(focus));
    const desired=sites.slice(0,4);
    for(const slot of lights){
      const intensity=slot.site&&desired.includes(slot.site)?400*(1-THREE.MathUtils.smoothstep(slot.site.position.distanceTo(focus),55,100)):0;
      slot.light.intensity=THREE.MathUtils.lerp(slot.light.intensity,intensity,blend);
      if(!intensity&&slot.light.intensity<.15){slot.light.intensity=0;slot.site=null;}
    }
    for(const site of desired){
      if(lights.some(slot=>slot.site===site))continue;
      const slot=lights.find(slot=>!slot.site);if(!slot)break;
      slot.site=site;slot.light.position.copy(site.position);
    }
  };
  const transform=new THREE.Object3D();
  let lastX=Infinity,lastZ=Infinity,lastY=Infinity;
  const update=(time:number,focus:THREE.Vector3,heading:number)=>{
    rainMaterial.uniforms.time.value=time;steamMaterial.uniforms.time.value=time;splashMaterial.uniforms.time.value=time;
    rainGroup.position.set(focus.x,focus.y-.85,focus.z);rainGroup.rotation.y=heading+Math.PI;
    const nearest=wetRoad.update(time,focus);
    updateLights(time,focus,nearest);
    if(Math.hypot(focus.x-lastX,focus.z-lastZ)<18&&Math.abs(focus.y-lastY)<.2)return;
    lastX=focus.x;lastZ=focus.z;lastY=focus.y;
    if(!nearest){steams.forEach(steam=>steam.visible=false);splashes.visible=false;return;}
    splashes.visible=true;
    const direction=nearest.direction.x*Math.sin(heading)+nearest.direction.z*Math.cos(heading)>=0?1:-1;
    steams.forEach((steam,index)=>{
      const side=index%2===0?-1:1,sample=sampleRoad(nearest.road,nearest.distance+direction*(index*43+18),side*(nearest.road.width/2+.45));
      steam.visible=true;steam.position.set(sample.point.x,sample.point.y+2.48,sample.point.z);steam.rotation.y=sample.heading;
    });
    splashOffsets.forEach((splash,index)=>{
      const sample=sampleRoad(nearest.road,nearest.distance+direction*splash.distance,splash.lateral*nearest.road.width);
      transform.position.set(sample.point.x,sample.point.y+.056,sample.point.z);transform.rotation.set(-Math.PI/2,0,0);transform.scale.setScalar(splash.scale);transform.updateMatrix();splashes.setMatrixAt(index,transform.matrix);
    });
    splashes.instanceMatrix.needsUpdate=true;
  };
  const dispose=()=>{
    wetRoad.dispose();
    rainGeometry.dispose();rainMaterial.dispose();steamGeometry.dispose();steamMaterial.dispose();splashGeometry.dispose();splashMaterial.dispose();
    if(scene.background===background){scene.background=previous.background;scene.backgroundIntensity=previous.backgroundIntensity;scene.backgroundBlurriness=previous.backgroundBlurriness;}
    if(scene.fog===fog)scene.fog=previous.fog;
    if(scene.environment===environmentTarget.texture){scene.environment=previous.environment;scene.environmentIntensity=previous.environmentIntensity;}
    environmentTarget.dispose();group.removeFromParent();group.clear();
  };
  const resetTimeline=()=>{
    lastTime=null;lastX=Infinity;lastY=Infinity;lastZ=Infinity;
    for(const slot of lights){slot.site=null;slot.light.intensity=0;}
  };
  return {group,update,dispose,resetTimeline};
}
