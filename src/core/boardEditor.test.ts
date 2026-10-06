import { describe,it,expect } from "vitest";
import { addPart,addPin,editPin,emptyBoard,ensureNet,movePart,removePart,removePin } from "./boardEditor";
describe("geometry editor integrity",()=>{
  it("handles large boards without spreading coordinates into function arguments",()=>{
    const b=addPart(emptyBoard(),"U1","top",{x:0,y:0});b.parts[0].outline=[];
    b.pins=Array.from({length:200_000},(_,i)=>({part:0,number:`${i+1}`,x:i,y:0,radius:1,side:"top" as const,net:0}));b.parts[0].pinCount=b.pins.length;
    const moved=movePart(b,0,{x:20,y:10});expect(moved.pins).toHaveLength(200_000);expect(Number.isFinite(moved.bounds.maxX)).toBe(true);
    expect(()=>addPin(b,0,{x:Infinity,y:0})).toThrow();
  });
  it("keeps contiguous pin ownership when adding/removing pads in earlier parts",()=>{
    let b=addPart(emptyBoard(),"U1","top",{x:100,y:100});b=addPart(b,"U2","bottom",{x:200,y:200});
    b=addPin(b,1,{x:201,y:200});b=addPin(b,0,{x:99,y:100});b=addPin(b,0,{x:101,y:100});
    expect(b.parts[1].firstPin).toBe(2);expect(b.pins.map((p)=>p.part)).toEqual([0,0,1]);
    b=removePin(b,0);expect(b.parts[1].firstPin).toBe(1);
    b=removePart(b,0);expect(b.parts[0].firstPin).toBe(0);expect(b.pins[0].part).toBe(0);
  });
  it("moves a whole part, rebuilds nets, and leaves the original untouched",()=>{
    let b=addPin(addPart(emptyBoard(),"U1","top",{x:100,y:100}),0,{x:105,y:100});
    const [n,net]=ensureNet(b,"VCC");b=editPin(n,0,{net});
    const moved=movePart(b,0,{x:200,y:300});expect(moved.pins[0].x).toBe(205);expect(moved.pins[0].y).toBe(300);
    expect(b.pins[0].x).toBe(105);expect(moved.nets[net].pins).toEqual([0]);expect(moved.nets[0].pins).toEqual([]);
    expect(()=>editPin(b,0,{x:NaN})).toThrow();
  });
});
