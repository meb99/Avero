import type { Board, Bounds, Part, Pin, Point, Side } from "./types";
import { partCenter } from "./board";

const valid = (n:number) => Number.isFinite(n) && Math.abs(n)<1e9;
const bounds = (points:Iterable<Point>, fallback:Bounds={minX:0,minY:0,maxX:0,maxY:0}):Bounds => {
  const out={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(const p of points) {
    if(!valid(p.x)||!valid(p.y))throw Error("Invalid board geometry");
    out.minX=Math.min(out.minX,p.x);out.maxX=Math.max(out.maxX,p.x);
    out.minY=Math.min(out.minY,p.y);out.maxY=Math.max(out.maxY,p.y);
  }
  return out.minX===Infinity?fallback:out;
};
const rect = (x:number,y:number,w=60,h=40):Point[] => [{x:x-w/2,y:y-h/2},{x:x+w/2,y:y-h/2},{x:x+w/2,y:y+h/2},{x:x-w/2,y:y+h/2},{x:x-w/2,y:y-h/2}];

export function emptyBoard():Board {
  const outline=rect(500,350,1000,700);
  return {format:"avero",formatName:"Avero board",unit:"mil",outline:[outline],bounds:bounds(outline),parts:[],pins:[],testPoints:[],traces:[],layers:[],nets:[{name:"UNCONNECTED",kind:"unconnected",pins:[],testPoints:[],traces:[]}],warnings:[]};
}
/** Rebuild memberships/bounds after every geometry mutation. */
export function rebuildBoard(board:Board):Board {
  const nets=board.nets.map((n)=>({...n,pins:[] as number[],testPoints:[] as number[],traces:[] as number[]}));
  board.pins.forEach((p,i)=>nets[p.net]?.pins.push(i));
  board.testPoints.forEach((p,i)=>nets[p.net]?.testPoints.push(i));
  board.traces?.forEach((p,i)=>nets[p.net]?.traces.push(i));
  const parts=board.parts.map((p)=>({...p,bounds:bounds(p.outline.length ? p.outline : board.pins.slice(p.firstPin,p.firstPin+p.pinCount),p.bounds)}));
  const all=[...board.outline.flat(),...parts.flatMap((p)=>p.outline),...board.pins,...board.testPoints,...(board.traces??[]).flatMap((t)=>[{x:t.x1,y:t.y1},{x:t.x2,y:t.y2}])];
  return {...board,parts,nets,bounds:all.length ? bounds(all):board.bounds};
}
export function movePart(board:Board,part:number,where:Point):Board {
  if (!valid(where.x)||!valid(where.y)||!board.parts[part]) throw Error("Invalid component position");
  const old=partCenter(board.parts[part]), dx=where.x-old.x,dy=where.y-old.y;
  const move=<T extends Point>(p:T):T=>({...p,x:p.x+dx,y:p.y+dy});
  return rebuildBoard({...board,parts:board.parts.map((p,i)=>i===part?{...p,outline:p.outline.map(move),pads:p.pads?.map((p)=>({...move(p),radius:p.radius}))}:p),pins:board.pins.map((p)=>p.part===part?move(p):p)});
}
export function editPin(board:Board,index:number,change:Partial<Pin>):Board {
  const old=board.pins[index];if(!old)throw Error("Choose a pad first");
  const p={...board.pins[index],...change};
  if(p.part!==old.part)throw Error("Use the component tools to change a pad's owner");
  if (![p.x,p.y,p.radius].every(valid)||p.radius<=0||!p.number.trim()||!board.nets[p.net]) throw Error("Invalid pad data");
  if (p.pad && (![p.pad.w,p.pad.h,p.pad.angle].every(valid)||p.pad.w<=0||p.pad.h<=0)) throw Error("Invalid pad shape");
  if (board.pins.some((other,i)=>i!==index && other.part===p.part && other.number.toUpperCase()===p.number.toUpperCase())) throw Error("Pin number already exists");
  const owner=board.parts[p.part].name;
  return rebuildBoard({...board,pins:board.pins.map((old,i)=>i===index?p:old),readings:board.readings?.map((r)=>r.part===owner&&r.pin===old.number?{...r,pin:p.number}:r)});
}
export function ensureNet(board:Board,name:string):[Board,number] {
  name=name.trim();if(!name)name="UNCONNECTED";
  const found=board.nets.findIndex((n)=>n.name===name);if(found>=0)return[board,found];
  return [{...board,nets:[...board.nets,{name,kind:name==="UNCONNECTED"?"unconnected":/^(GND|VSS)$/i.test(name)?"ground":"signal",pins:[],testPoints:[],traces:[]}]},board.nets.length];
}
export function addPart(board:Board,name:string,side:Side,at:Point):Board {
  if(!name.trim()||board.parts.some((p)=>p.name.toUpperCase()===name.trim().toUpperCase()))throw Error("Component name already exists or is empty");
  if(!valid(at.x)||!valid(at.y))throw Error("Invalid position");
  const outline=rect(at.x,at.y);
  const part:Part={name:name.trim(),side,mount:"smd",firstPin:board.pins.length,pinCount:0,outline,bounds:bounds(outline)};
  return rebuildBoard({...board,parts:[...board.parts,part]});
}
export function addPin(board:Board,part:number,at:Point):Board {
  if(!valid(at.x)||!valid(at.y))throw Error("Invalid pad position");
  const p=board.parts[part];if(!p)throw Error("Choose a component first");
  let number=1;while(board.pins.some((pin)=>pin.part===part&&pin.number===`${number}`))number++;
  const [b,net]=ensureNet(board,"UNCONNECTED"), pos=p.firstPin+p.pinCount;
  const pins=[...b.pins.slice(0,pos),{part,number:`${number}`,x:at.x,y:at.y,radius:8,side:p.side,net},...b.pins.slice(pos)];
  const parts=b.parts.map((p,i)=>({...p,firstPin:p.firstPin+(i>part?1:0),pinCount:p.pinCount+(i===part?1:0)}));
  return rebuildBoard({...b,parts,pins});
}
export function removePart(board:Board,part:number):Board {
  const p=board.parts[part];if(!p)return board;
  const pins=board.pins.filter((pin)=>pin.part!==part).map((pin)=>({...pin,part:pin.part>part?pin.part-1:pin.part}));
  const parts=board.parts.filter((_,i)=>i!==part).map((other)=>({...other,firstPin:other.firstPin>p.firstPin?other.firstPin-p.pinCount:other.firstPin}));
  return rebuildBoard({...board,parts,pins,readings:board.readings?.filter((r)=>r.part!==p.name)});
}
export function removePin(board:Board,index:number):Board {
  const pin=board.pins[index];if(!pin)return board;
  const parts=board.parts.map((p,i)=>({...p,pinCount:p.pinCount-(i===pin.part?1:0),firstPin:p.firstPin-(i>pin.part?1:0)}));
  return rebuildBoard({...board,parts,pins:board.pins.filter((_,i)=>i!==index),readings:board.readings?.filter((r)=>r.part!==board.parts[pin.part].name||r.pin!==pin.number)});
}
export function renamePart(board:Board,index:number,name:string,device:string):Board {
  name=name.trim();if(!name||board.parts.some((p,i)=>i!==index&&p.name.toUpperCase()===name.toUpperCase()))throw Error("Component name already exists or is empty");
  const old=board.parts[index].name;
  return {...board,parts:board.parts.map((p,i)=>i===index?{...p,name,device:device||undefined}:p),readings:board.readings?.map((r)=>r.part===old?{...r,part:name}:r)};
}
export const boardDocument=(board:Board)=>JSON.stringify({averoBoard:1,board:{...board,readings:board.readings?.map((r)=>({...r,sourceFormat:r.sourceFormat??(board.format==="xzz"?"XZZ":board.formatName)}))}},null,2);
