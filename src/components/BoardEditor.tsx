import { useMemo, useRef, useState } from "react";
import { BoardModel, partCenter } from "../core/board";
import { addPart, addPin, boardDocument, editPin, emptyBoard, ensureNet, movePart, removePart, removePin, renamePart } from "../core/boardEditor";
import { saveBytes } from "../core/loader";
import type { Board, Point, Selection, Side } from "../core/types";
import { useI18n } from "../i18n";
import type { Settings } from "../settings";
import type { Palette } from "../render/palette";
import { importFiles } from "../workbench/library";
import { BoardView, type BoardViewHandle } from "./BoardView";
import { Dialog } from "./Dialogs";

interface Props { board?: Board; name?: string; settings: Settings; palette: Palette; onClose(): void; onSaved(path: string): void }
export function BoardEditor({board:original,name,settings,palette,onClose,onSaved}:Props) {
  const {lang}=useI18n(), de=lang==="de";
  const [board,setBoard]=useState<Board>(()=>original??emptyBoard());
  const [past,setPast]=useState<Board[]>([]),[future,setFuture]=useState<Board[]>([]);
  const [selection,setSelection]=useState<Selection>({kind:"none"});
  const [side,setSide]=useState<"top"|"bottom">("top");
  const [mode,setMode]=useState<"select"|"move"|"part"|"pad">("select");
  const [newName,setNewName]=useState("U_NEW");
  const [error,setError]=useState<string|null>(null),[saving,setSaving]=useState(false);
  const [toLibrary,setToLibrary]=useState(true),[discard,setDiscard]=useState(false);
  const [revision,setRevision]=useState(0);
  const view=useRef<BoardViewHandle>(null);
  const model=useMemo(()=>new BoardModel(board),[board]);
  const partIndex=selection.kind==="part"?selection.part:selection.kind==="pin"?board.pins[selection.pin]?.part:undefined;
  const part=partIndex===undefined?undefined:board.parts[partIndex];
  const pin=selection.kind==="pin"?board.pins[selection.pin]:undefined;
  const change=(fn:(b:Board)=>Board)=>{
    try {const next=fn(board);setPast((p)=>[...p.slice(-29),board]);setFuture([]);setBoard(next);setRevision((n)=>n+1);setError(null);return true;}catch(e){setError(String(e));return false;}
  };
  const undo=()=>{const previous=past.at(-1);if(!previous)return;setFuture((f)=>[board,...f]);setPast((p)=>p.slice(0,-1));setBoard(previous);setSelection({kind:"none"});setRevision((n)=>n+1);};
  const redo=()=>{if(!future[0])return;setPast((p)=>[...p,board]);setBoard(future[0]);setFuture((f)=>f.slice(1));setSelection({kind:"none"});setRevision((n)=>n+1);};
  const point=(at:Point)=>{
    if(mode==="part") {const idx=board.parts.length;if(change((b)=>addPart(b,newName,side,at))){setSelection({kind:"part",part:idx});setMode("select");}}
    else if(mode==="pad"&&part&&partIndex!==undefined){const idx=part.firstPin+part.pinCount;if(change((b)=>addPin(b,partIndex,at))){setSelection({kind:"pin",pin:idx});setMode("select");}}
    else if(mode==="move"&&selection.kind==="pin"){change((b)=>editPin(b,selection.pin,at));setMode("select");}
    else if(mode==="move"&&partIndex!==undefined){change((b)=>movePart(b,partIndex,at));setMode("select");}
  };
  const save=async()=>{
    if(!board.parts.length&&!board.testPoints.length){setError(de?"Lege zuerst ein Bauteil mit Pads an.":"Add a component with pads first.");return;}
    setSaving(true);setError(null);
    try {
      const base=(name??"Mein-Board").replace(/\.[^.]+$/,"").replace(/[\\/:\u0000-\u001f]/g,"-").slice(0,150);
      const path=await saveBytes(new TextEncoder().encode(boardDocument(board)),de?"Board speichern":"Save board",`${base}-bearbeitet.averoboard`,{name:"Avero Board",extensions:["averoboard"]});
      if(!path)return;
      if(toLibrary){const result=await importFiles([path],"");if(result.errors.length){setError(result.errors.join("\n"));return;}onSaved(result.imported[0]??path);}else onSaved(path);
    }catch(e){setError(String(e));}finally{setSaving(false);}
  };
  const position=pin??(part?partCenter(part):{x:0,y:0});
  return <Dialog title={de?"Boardeditor":"Board editor"} className="board-editor-dialog" onClose={()=>past.length?setDiscard(true):onClose()}>
    <p className="muted">{de?"Bauteil oder Pad auswählen. Mit „Position setzen“ anschließend die Zielstelle anklicken. Koordinaten und Padgrößen sind in mil. Speichern erzeugt eine eigene Boarddatei.":"Select a component or pad, then use Set position and click its new location. Coordinates and pad sizes are in mil. Save creates an edited board file."}</p>
    <div className="board-editor-tools">
      <button disabled={!past.length||saving} onClick={undo}>{de?"Rückgängig":"Undo"}</button><button disabled={!future.length||saving} onClick={redo}>{de?"Wiederholen":"Redo"}</button>
      <button onClick={()=>view.current?.fit()}>{de?"Einpassen":"Fit"}</button>
      <button onClick={()=>view.current?.zoomBy(1.5)}>+</button><button onClick={()=>view.current?.zoomBy(1/1.5)}>−</button>
      <select aria-label={de?"Seite":"Side"} value={side} onChange={(e)=>setSide(e.target.value as "top"|"bottom")}><option value="top">{de?"Oberseite":"Top"}</option><option value="bottom">{de?"Unterseite":"Bottom"}</option></select>
      <button className={mode==="move"?"primary":""} disabled={partIndex===undefined} onClick={()=>setMode(mode==="move"?"select":"move")}>{de?"Position setzen":"Set position"}</button>
      <input aria-label={de?"Neues Bauteil":"New component"} value={newName} onChange={(e)=>setNewName(e.target.value)} style={{width:105}} />
      <button className={mode==="part"?"primary":""} onClick={()=>setMode(mode==="part"?"select":"part")}>{de?"Bauteil platzieren":"Place component"}</button>
      <button className={mode==="pad"?"primary":""} disabled={partIndex===undefined} onClick={()=>setMode(mode==="pad"?"select":"pad")}>{de?"Pad platzieren":"Place pad"}</button>
    </div>
    <div className="board-editor-grid">
      <div className="board-editor-preview"><BoardView ref={view} model={model} side={side} rotation={0} selection={selection} settings={settings} palette={palette} onSelect={(s)=>{setSelection(s);setMode("select");}} onPointPick={mode==="select"?undefined:point} /></div>
      <aside className="board-editor-properties">
        <label>{de?"Bauteil":"Component"}<select value={partIndex??""} onChange={(e)=>setSelection(e.target.value===""?{kind:"none"}:{kind:"part",part:Number(e.target.value)})}><option value="">—</option>{board.parts.map((p,i)=><option key={i} value={i}>{p.name}</option>)}</select></label>
        {part&&partIndex!==undefined&&<>
          <label>{de?"Pad":"Pad"}<select value={selection.kind==="pin"?selection.pin:""} onChange={(e)=>setSelection(e.target.value===""?{kind:"part",part:partIndex}:{kind:"pin",pin:Number(e.target.value)})}><option value="">{de?"Ganzes Bauteil":"Whole component"}</option>{board.pins.slice(part.firstPin,part.firstPin+part.pinCount).map((p,i)=><option key={i} value={part.firstPin+i}>{p.number} · {board.nets[p.net]?.name}</option>)}</select></label>
          <form key={`${selection.kind}-${partIndex}-${selection.kind==="pin"?selection.pin:""}-${revision}`} onSubmit={(e)=>{
            e.preventDefault();const data=new FormData(e.currentTarget),n=(key:string)=>Number(data.get(key)),s=(key:string)=>String(data.get(key)??"");
            change((b)=>{
              b=renamePart(b,partIndex,s("name"),s("device"));
              if(selection.kind==="pin") {const [next,net]=ensureNet(b,s("net"));return editPin(next,selection.pin,{x:n("x"),y:n("y"),number:s("number"),side:s("side") as Side,net,radius:Math.max(n("w"),n("h"))/2,pad:{w:n("w"),h:n("h"),angle:n("angle"),round:s("shape")==="round"}});}
              const moved=movePart(b,partIndex,{x:n("x"),y:n("y")});return {...moved,parts:moved.parts.map((p,i)=>i===partIndex?{...p,side:s("side") as Side}:p),pins:moved.pins.map((p)=>p.part===partIndex?{...p,side:s("side") as Side}:p)};
            });
          }}>
            <label>{de?"Bezeichnung":"Designator"}<input name="name" defaultValue={part.name} required /></label>
            <label>{de?"Wert / Typ":"Value / type"}<input name="device" defaultValue={part.device??""} /></label>
            <div className="board-editor-pair"><label>X<input name="x" type="number" step="any" defaultValue={position.x} required /></label><label>Y<input name="y" type="number" step="any" defaultValue={position.y} required /></label></div>
            <label>{de?"Seite":"Side"}<select name="side" defaultValue={pin?.side??part.side}><option value="top">{de?"Oben":"Top"}</option><option value="bottom">{de?"Unten":"Bottom"}</option><option value="both">{de?"Beide":"Both"}</option></select></label>
            {pin&&<>
              <label>{de?"Pinnummer":"Pin number"}<input name="number" defaultValue={pin.number} required /></label>
              <label>{de?"Netz":"Net"}<input name="net" defaultValue={board.nets[pin.net]?.name} list="board-editor-nets" /><datalist id="board-editor-nets">{board.nets.map((n,i)=><option key={i} value={n.name} />)}</datalist></label>
              <div className="board-editor-pair"><label>{de?"Breite":"Width"}<input name="w" type="number" min="0.001" step="any" defaultValue={pin.pad?.w??pin.radius*2} required /></label><label>{de?"Höhe":"Height"}<input name="h" type="number" min="0.001" step="any" defaultValue={pin.pad?.h??pin.radius*2} required /></label></div>
              <label>{de?"Drehung":"Rotation"}<input name="angle" type="number" step="any" defaultValue={pin.pad?.angle??0} required /></label>
              <label>{de?"Form":"Shape"}<select name="shape" defaultValue={pin.pad?.round===false?"rect":"round"}><option value="round">{de?"Rund / oval":"Round / oval"}</option><option value="rect">{de?"Rechteck":"Rectangle"}</option></select></label>
            </>}
            <button type="submit" className="primary">{de?"Anwenden":"Apply"}</button>
          </form>
          <button className="danger" onClick={()=>{change((b)=>selection.kind==="pin"?removePin(b,selection.pin):removePart(b,partIndex));setSelection({kind:"none"});}}>{pin?(de?"Pad löschen":"Delete pad"):(de?"Bauteil löschen":"Delete component")}</button>
        </>}
      </aside>
    </div>
    {mode!=="select"&&<p role="status">{de?"Zielstelle auf dem Board anklicken. „Auswahl“ beendet das Platzieren.":"Click the destination on the board. Select exits placement."} <button onClick={()=>setMode("select")}>{de?"Auswahl":"Select"}</button></p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {discard&&<div role="alert"><p>{de?"Die Bearbeitung ist noch nicht gespeichert.":"Your edits have not been saved."}</p><button onClick={()=>setDiscard(false)}>{de?"Weiter bearbeiten":"Keep editing"}</button><button onClick={onClose}>{de?"Verwerfen":"Discard"}</button></div>}
    <div className="board-editor-tools"><label className="check"><input type="checkbox" checked={toLibrary} onChange={(e)=>setToLibrary(e.target.checked)} />{de?"In Bibliothek übernehmen":"Add to library"}</label><button className="primary" disabled={saving} onClick={()=>void save()}>{saving?(de?"Speichert …":"Saving …"):(de?"Speichern und öffnen":"Save and open")}</button></div>
  </Dialog>;
}
