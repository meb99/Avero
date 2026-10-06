// SPDX-License-Identifier: GPL-3.0-or-later
// Avero's standalone file-to-file adapter for the vendored Allegro reader.
#include "lib/parser/parser.h"
#include "lib/structure/utils.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <unordered_set>

static std::string quoted(const std::string& s) {
    std::ostringstream out; out << '"';
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') out << '\\' << c;
        else if (c < 32) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << unsigned(c);
        else out << c;
    }
    out << '"'; return out.str();
}
static void append(std::ostringstream& out, const std::string& value, size_t& count) {
    if (count++) out << ','; out << value;
}
static std::string point(double x, double y) {
    if (!std::isfinite(x) || !std::isfinite(y) || std::abs(x)>1e9 || std::abs(y)>1e9) throw std::runtime_error("Invalid Allegro coordinate");
    std::ostringstream o; o << std::setprecision(12) << "{\"x\":" << x << ",\"y\":" << y << '}'; return o.str();
}
int main(int argc, char** argv) {
    if (argc != 3) return 2;
    try {
        auto parsed = parse_file(argv[1]);
        if (!parsed) throw std::runtime_error("Unsupported Allegro binary version (supported: 16.0–17.4)");
        auto& f = *parsed;
        auto* bytes = static_cast<uint8_t*>(f.region.get_address());
        uint32_t divisor; std::memcpy(&divisor, bytes+0x26c, 4);
        double unit;
        switch (bytes[0x180]) { case 1: unit=1;break;case 2:unit=1000;break;case 3:unit=1000/25.4;break;case 4:unit=10000/25.4;break;case 5:unit=1/25.4;break;default:throw std::runtime_error("Unknown Allegro coordinate unit"); }
        if (divisor==0) throw std::runtime_error("Invalid Allegro unit divisor");
        const double scale = unit/divisor;
        std::unordered_map<std::string,size_t> net_ids;
        std::vector<std::string> nets;
        auto net = [&](uint32_t pair) {
            std::string name = "UNCONNECTED";
            if (f.is_type(pair, 0x04)) { auto n=x1B_net_name(f.get_x04(pair).ptr1,&f); if(n&&*n) name=n; }
            auto it=net_ids.find(name); if(it!=net_ids.end()) return it->second;
            size_t id=nets.size(); nets.push_back(name);net_ids[name]=id;return id;
        };
        std::vector<uint32_t> keys;
        for (auto& [k,p] : f.ptrs) keys.push_back(k);
        std::sort(keys.begin(),keys.end());
        std::unordered_map<uint32_t,std::vector<uint32_t>> pads;
        for(auto k:keys) if(f.is_type(k,0x32)) pads[f.get_x32(k).ptr3].push_back(k);
        std::ostringstream parts,pins,vias,traces,outlines;
        parts<<std::setprecision(12);pins<<std::setprecision(12);vias<<std::setprecision(12);traces<<std::setprecision(12);
        size_t part_count=0,pin_count=0,via_count=0,trace_count=0,outline_count=0;
        for(auto k:keys) if(f.is_type(k,0x2D)) {
            auto symbol=f.get_x2D(k); auto name=x2D_refdes(k,&f);
            if(!name || name->empty()) continue;
            const size_t owner=part_count, first=pin_count;
            const std::string side=symbol.layer==0 ? "top":"bottom";
            bool part_through=false;
            for(auto pk:pads[k]) {
                auto p=f.get_x32(pk); auto number=x0D_pin_name(p.ptr5,&f);
                if(!number || number->empty()) throw std::runtime_error("Placed Allegro pad has no pin name");
                double w=std::abs((double(p.coords[2])-p.coords[0])*scale),h=std::abs((double(p.coords[3])-p.coords[1])*scale);
                bool round=false,through=false; double angle=symbol.rotation/1000.;
                if(f.is_type(p.ptr5,0x0D)) {
                    auto def=f.get_x0D(p.ptr5);angle+=def.rotation/1000.;
                    if(f.is_type(def.pad_ptr,0x1C)) {
                        auto stack=f.get_x1C(def.pad_ptr);through=stack.pad_info.pad_type==ThroughVia;
                        size_t fixed=f.hdr->magic<A_172?10:21, stride=f.hdr->magic<A_172?3:4;
                        size_t slot=fixed+(symbol.layer==0?0:std::max(1u,unsigned(stack.layer_count))-1)*stride+2;
                        if(slot<stack.parts.size() && stack.parts[slot].w>0 && stack.parts[slot].h>=0) {
                            auto shape=stack.parts[slot];w=shape.w*scale;h=(shape.h>0?shape.h:shape.w)*scale;round=shape.t==2;
                        }
                    }
                }
                double x=(double(p.coords[0])+p.coords[2])*scale/2,y=(double(p.coords[1])+p.coords[3])*scale/2;
                point(x,y);w=std::max(w,0.000001);h=std::max(h,0.000001);
                part_through=part_through||through;
                std::ostringstream o;o<<std::setprecision(12)<<"{\"part\":"<<owner<<",\"number\":"<<quoted(*number)<<",\"x\":"<<x<<",\"y\":"<<y<<",\"radius\":"<<std::min(w,h)/2<<",\"side\":"<<quoted(through?"both":side)<<",\"net\":"<<net(p.ptr1)<<",\"pad\":{\"w\":"<<w<<",\"h\":"<<h<<",\"angle\":"<<angle<<",\"round\":"<<(round?"true":"false")<<"}}";
                append(pins,o.str(),pin_count);
            }
            std::string body="[]";
            if(first==pin_count) {
                const double x=symbol.coords[0]*scale,y=symbol.coords[1]*scale;
                body="["+point(x-1,y-1)+","+point(x+1,y-1)+","+point(x+1,y+1)+","+point(x-1,y+1)+","+point(x-1,y-1)+"]";
            }
            std::ostringstream o;o<<"{\"name\":"<<quoted(*name)<<",\"side\":"<<quoted(side)<<",\"mount\":"<<quoted(part_through?"th":"smd")<<",\"firstPin\":"<<first<<",\"pinCount\":"<<pin_count-first<<",\"outline\":"<<body<<",\"pads\":[]}";
            append(parts,o.str(),part_count);
        }
        for(auto k:keys) if(f.is_type(k,0x33)) {
            auto v=f.get_x33(k);double radius=std::min(std::abs(double(v.bb_coords[2])-v.bb_coords[0]),std::abs(double(v.bb_coords[3])-v.bb_coords[1]))*scale/2;
            if(f.is_type(v.ptr4,0x1C)){auto stack=f.get_x1C(v.ptr4);size_t slot=(f.hdr->magic<A_172?10:21)+2;if(slot<stack.parts.size()&&stack.parts[slot].w>0)radius=stack.parts[slot].w*scale/2;}
            std::ostringstream o;o<<std::setprecision(12)<<"{\"kind\":\"via\",\"x\":"<<v.coords[0]*scale<<",\"y\":"<<v.coords[1]*scale<<",\"radius\":"<<std::max(radius,0.000001)<<",\"side\":\"both\",\"net\":"<<net(v.ptr1)<<'}';append(vias,o.str(),via_count);
        }
        std::vector<std::string> layer_names;
        for(unsigned i=0;i<f.layer_count;++i) layer_names.push_back("ETCH_"+std::to_string(i+1));
        if(f.layers.size()>4) {
            auto key=std::get<1>(f.layers[4]);auto it=f.x2A_map.find(key);
            if(it!=f.x2A_map.end()) { auto& l=it->second;
                for(size_t i=0;i<layer_names.size();++i) {
                    if(!l.references && i<l.local_entries.size()) layer_names[i]=l.local_entries[i].s;
                    if(l.references && i<l.reference_entries.size()) {auto p=str_lookup(l.reference_entries[i].ptr,f);if(p)layer_names[i]=p;}
                }
            }
        }
        auto segment=[&](uint32_t parent,double x1,double y1,double x2,double y2,double width) {
            uint8_t cls=0,layer=0;uint32_t pair=0;
            if(f.is_type(parent,0x05)){auto c=f.get_x05(parent);cls=c.subtype;layer=c.layer;pair=c.ptr1;}
            else if(f.is_type(parent,0x28)){auto c=f.get_x28(parent);cls=c.subtype;layer=c.layer;pair=c.ptr1;}
            else return;
            if(cls==1 && (layer==0xea || layer==0xfd)) {append(outlines,"["+point(x1*scale,y1*scale)+","+point(x2*scale,y2*scale)+"]",outline_count);return;}
            if(cls!=6 || layer>=layer_names.size()) return;
            std::ostringstream o;o<<std::setprecision(12)<<"{\"x1\":"<<x1*scale<<",\"y1\":"<<y1*scale<<",\"x2\":"<<x2*scale<<",\"y2\":"<<y2*scale<<",\"width\":"<<std::max(width*scale,0.)<<",\"side\":"<<quoted(layer==0?"top":layer+1==f.layer_count?"bottom":"both")<<",\"layer\":"<<unsigned(layer)<<",\"net\":"<<net(pair)<<'}';append(traces,o.str(),trace_count);
        };
        for(auto k:keys) {
            if(f.is_type(k,0x15)){auto v=f.get_x15(k);segment(v.parent,v.coords[0],v.coords[1],v.coords[2],v.coords[3],v.width);}
            if(f.is_type(k,0x16)){auto v=f.get_x16(k);segment(v.parent,v.coords[0],v.coords[1],v.coords[2],v.coords[3],v.width);}
            if(f.is_type(k,0x17)){auto v=f.get_x17(k);segment(v.parent,v.coords[0],v.coords[1],v.coords[2],v.coords[3],v.width);}
            if(f.is_type(k,0x01)) {
                auto v=f.get_x01(k);auto [cx,cy]=x01_center(&v);double r=std::hypot(v.coords[0]-cx,v.coords[1]-cy);
                if(!std::isfinite(r) || r<=0) continue;
                double a=std::atan2(v.coords[1]-cy,v.coords[0]-cx),end=std::atan2(v.coords[3]-cy,v.coords[2]-cx);
                double delta=end-a;
                // Allegro arc winding is encoded in the type's high byte.
                bool clockwise=(v.t&0x400000)!=0;
                if(clockwise){while(delta>=0)delta-=2*M_PI;}else{while(delta<=0)delta+=2*M_PI;}
                unsigned steps=std::min(1024u,std::max(2u,unsigned(std::ceil(std::abs(delta)*std::sqrt(r*scale/0.2)))));
                double x=v.coords[0],y=v.coords[1];
                for(unsigned i=1;i<=steps;++i){double nx=i==steps?v.coords[2]:cx+r*std::cos(a+delta*i/steps),ny=i==steps?v.coords[3]:cy+r*std::sin(a+delta*i/steps);segment(v.parent,x,y,nx,ny,v.width);x=nx;y=ny;}
            }
        }
        std::ofstream out(argv[2],std::ios::binary|std::ios::trunc);
        if(!out)throw std::runtime_error("Cannot write Allegro output");
        out<<"{\"averoBoard\":1,\"board\":{\"unit\":\"mil\",\"outline\":["<<outlines.str()<<"],\"parts\":["<<parts.str()<<"],\"pins\":["<<pins.str()<<"],\"nets\":[";
        for(size_t i=0;i<nets.size();++i){if(i)out<<',';out<<"{\"name\":"<<quoted(nets[i])<<'}';}
        out<<"],\"testPoints\":["<<vias.str()<<"],\"traces\":["<<traces.str()<<"],\"layers\":[";
        for(size_t i=0;i<layer_names.size();++i){if(i)out<<',';out<<"{\"name\":"<<quoted(layer_names[i])<<'}';}
        out<<"],\"warnings\":[\"Allegro import: copper fills, drawing text and assembly polygons are not converted. Via drill/span and component values are not decoded.\"]}}";
        if(!out)throw std::runtime_error("Allegro output write failed");
        return 0;
    } catch(const std::exception& e) { std::cerr<<e.what()<<'\n';return 1; }
}
