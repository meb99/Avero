import { describe,it,expect } from "vitest";
import { addPart,addPin,editPin,emptyBoard,ensureNet,movePart,removePart,removePin,renamePart } from "./boardEditor";
describe("geometry editor integrity",()=>{
  it("edits imported duplicate designators without moving or deleting the other part's readings",()=>{
    let b=addPin(addPart(emptyBoard(),"U1","top",{x:100,y:100}),0,{x:100,y:100});
    b=addPin(addPart(b,"U2","bottom",{x:200,y:200}),1,{x:200,y:200});b=editPin(b,1,{number:"2"});
    b.parts[1].name="U1";
    b.readings=[{part:"U1",pin:"1",quantity:"voltage",value:0.44,raw:"0.44V",list:"Voltage"},{part:"U1",pin:"2",quantity:"voltage",value:1.8,raw:"1.8V",list:"Voltage"}];
    expect(renamePart(b,0,"U1","changed").parts[0].device).toBe("changed");
    expect(renamePart(b,0,"U_NEW","").readings?.map((r)=>[r.part,r.pin])).toEqual([["U_NEW","1"],["U1","2"]]);
    expect(editPin(b,0,{number:"3"}).readings?.map((r)=>r.pin)).toEqual(["3","2"]);
    expect(removePart(b,0).readings?.map((r)=>r.pin)).toEqual(["2"]);
    expect(removePin(b,0).readings?.map((r)=>r.pin)).toEqual(["2"]);
  });
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
