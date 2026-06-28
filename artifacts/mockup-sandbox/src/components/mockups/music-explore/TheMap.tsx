import React from 'react';
import { Play, Search, Maximize2, MoreHorizontal, ChevronRight, X, Music, Disc, Users, Clock, Radio, Activity, Link as LinkIcon, AlertCircle, Share, Bookmark } from 'lucide-react';
import './map.css';

export function TheMap() {
  return (
    <div className="map-container flex h-screen w-full overflow-hidden text-sm">
      {/* LEFT: GRAPH AREA */}
      <div className="flex-1 relative bg-black flex flex-col">
        {/* Top Nav / Breadcrumb */}
        <div className="absolute top-0 left-0 right-0 p-4 z-20 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <div className="w-8 h-8 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <Search className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="flex items-center bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-full px-4 py-1.5 map-mono text-xs text-zinc-400">
              <span className="hover:text-white cursor-pointer transition-colors">Queen</span>
              <ChevronRight className="w-3 h-3 mx-2 opacity-50" />
              <span className="hover:text-white cursor-pointer transition-colors">A Night at the Opera</span>
              <ChevronRight className="w-3 h-3 mx-2 opacity-50" />
              <span className="text-white">Bohemian Rhapsody</span>
            </div>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <button className="w-8 h-8 rounded bg-zinc-900/80 backdrop-blur border border-zinc-800 flex items-center justify-center hover:bg-zinc-800 transition-colors">
              <Maximize2 className="w-4 h-4 text-zinc-400" />
            </button>
          </div>
        </div>

        {/* SVG Edges */}
        <div className="absolute inset-0 z-0">
          <svg className="w-full h-full opacity-30">
            {/* Center to Album */}
            <line x1="50%" y1="50%" x2="30%" y2="25%" stroke="white" strokeWidth="1" className="edge-line" />
            <text x="40%" y="37%" fill="#a1a1aa" fontSize="10" className="map-mono" textAnchor="middle">PART OF</text>
            
            {/* Center to Members */}
            <line x1="50%" y1="50%" x2="70%" y2="30%" stroke="white" strokeWidth="1" />
            <text x="60%" y="40%" fill="#a1a1aa" fontSize="10" className="map-mono" textAnchor="middle">CREDITS</text>
            
            {/* Member expansions */}
            <line x1="70%" y1="30%" x2="80%" y2="15%" stroke="white" strokeWidth="1" strokeDasharray="2" opacity="0.5" />
            <line x1="70%" y1="30%" x2="85%" y2="35%" stroke="white" strokeWidth="1" strokeDasharray="2" opacity="0.5" />

            {/* Center to Genres */}
            <line x1="50%" y1="50%" x2="25%" y2="60%" stroke="white" strokeWidth="1" />
            <text x="37%" y="55%" fill="#a1a1aa" fontSize="10" className="map-mono" textAnchor="middle">GENRE</text>

            {/* Center to Similar */}
            <line x1="50%" y1="50%" x2="75%" y2="70%" stroke="white" strokeWidth="1" />
            <text x="62%" y="60%" fill="#a1a1aa" fontSize="10" className="map-mono" textAnchor="middle">SIMILAR TO</text>
            
            {/* Similar expansions */}
            <line x1="75%" y1="70%" x2="85%" y2="85%" stroke="white" strokeWidth="1" strokeDasharray="2" opacity="0.5" />
          </svg>
        </div>

        {/* NODES */}
        
        {/* Anchor Node (Center) */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <div className="absolute inset-0 rounded-full border border-green-500/30 node-pulse pointer-events-none scale-[1.3]"></div>
          <div className="graph-node bg-zinc-900 border border-zinc-700 p-2 rounded-xl w-64 shadow-2xl cursor-pointer hover:border-green-500/50">
            <div className="flex gap-3">
              <img src="/__mockup/images/map-queen-stage.png" alt="Cover" className="w-16 h-16 rounded object-cover border border-zinc-800" />
              <div className="flex flex-col justify-center overflow-hidden">
                <div className="text-xs font-medium text-white truncate">Bohemian Rhapsody</div>
                <div className="text-[10px] text-zinc-400 truncate">Queen</div>
                <div className="flex items-center gap-1 mt-2">
                  <Play className="w-3 h-3 text-green-500 fill-green-500" />
                  <div className="h-1 bg-zinc-800 rounded-full flex-1 overflow-hidden">
                    <div className="h-full bg-green-500 w-1/3"></div>
                  </div>
                  <span className="text-[8px] text-zinc-500 map-mono">5:55</span>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-2 -right-2 px-1.5 py-0.5 rounded bg-green-950 border border-green-800 text-[8px] font-bold text-green-400 tracking-wider">SPOTIFY</div>
          </div>
        </div>

        {/* Album Node */}
        <div className="absolute top-[25%] left-[30%] -translate-x-1/2 -translate-y-1/2 z-10 group">
          <div className="graph-node flex items-center gap-2 bg-zinc-900/80 backdrop-blur border border-zinc-800 p-1.5 pl-2 pr-3 rounded-full cursor-pointer hover:border-zinc-500">
            <img src="/__mockup/images/map-album.png" alt="Album" className="w-6 h-6 rounded-full object-cover" />
            <div className="flex flex-col">
              <span className="text-[10px] text-white font-medium leading-none">A Night at the Opera</span>
              <span className="text-[8px] text-zinc-500 mt-0.5 map-mono">ALBUM • 1975</span>
            </div>
            <div className="w-4 h-4 ml-2 rounded bg-zinc-800 flex items-center justify-center text-[7px] text-zinc-400 font-bold border border-zinc-700">WD</div>
          </div>
        </div>

        {/* Credits Node */}
        <div className="absolute top-[30%] left-[70%] -translate-x-1/2 -translate-y-1/2 z-10">
          <div className="graph-node bg-zinc-900/80 backdrop-blur border border-pink-900/30 ring-1 ring-pink-500/20 p-2 rounded-lg cursor-pointer">
            <div className="text-[9px] text-pink-400/80 map-mono mb-1.5 uppercase tracking-wider flex items-center gap-1">
              <Users className="w-2.5 h-2.5" /> Credits (6)
            </div>
            <div className="flex -space-x-2">
              <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px]">FM</div>
              <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px]">BM</div>
              <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px]">RT</div>
              <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] bg-zinc-800/80 backdrop-blur">+3</div>
            </div>
            <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded bg-[#f472b6]/20 flex items-center justify-center text-[7px] text-[#f472b6] font-bold border border-[#f472b6]/30">MB</div>
          </div>
        </div>

        {/* Expanded Credit: Freddie */}
        <div className="absolute top-[15%] left-[80%] -translate-x-1/2 -translate-y-1/2 z-10 opacity-70 hover:opacity-100 transition-opacity">
          <div className="graph-node text-xs flex items-center gap-1.5 bg-zinc-900/60 border border-zinc-800 px-2 py-1 rounded cursor-pointer">
            <span className="text-white">Freddie Mercury</span>
            <span className="text-[8px] text-zinc-500">Vocals, Piano</span>
          </div>
        </div>

        {/* Expanded Credit: Brian */}
        <div className="absolute top-[35%] left-[85%] -translate-x-1/2 -translate-y-1/2 z-10 opacity-70 hover:opacity-100 transition-opacity">
          <div className="graph-node text-xs flex items-center gap-1.5 bg-zinc-900/60 border border-zinc-800 px-2 py-1 rounded cursor-pointer">
            <span className="text-white">Brian May</span>
            <span className="text-[8px] text-zinc-500">Guitar</span>
          </div>
        </div>

        {/* Genres Node */}
        <div className="absolute top-[60%] left-[25%] -translate-x-1/2 -translate-y-1/2 z-10">
          <div className="graph-node bg-zinc-900/80 backdrop-blur border border-zinc-800 p-2 rounded-lg cursor-pointer flex flex-col gap-1.5">
            <div className="text-[9px] text-zinc-500 map-mono uppercase tracking-wider flex items-center gap-1">
              <Activity className="w-2.5 h-2.5" /> Genres
            </div>
            <div className="flex flex-wrap w-32 gap-1">
              <span className="text-[10px] bg-red-950/30 text-red-400 border border-red-900/50 px-1.5 py-0.5 rounded">Progressive Rock</span>
              <span className="text-[10px] bg-red-950/30 text-red-400 border border-red-900/50 px-1.5 py-0.5 rounded">Hard Rock</span>
              <span className="text-[10px] bg-red-950/30 text-red-400 border border-red-900/50 px-1.5 py-0.5 rounded">Art Rock</span>
            </div>
            <div className="absolute -bottom-1.5 -right-1.5 px-1 py-0.5 rounded bg-[#ef4444]/20 flex items-center justify-center text-[7px] text-[#ef4444] font-bold border border-[#ef4444]/30">LAST.FM</div>
          </div>
        </div>

        {/* Similar Artists Node */}
        <div className="absolute top-[70%] left-[75%] -translate-x-1/2 -translate-y-1/2 z-10">
          <div className="graph-node flex items-center gap-2 bg-zinc-900/80 backdrop-blur border border-zinc-800 p-1.5 pl-2 pr-3 rounded-full cursor-pointer">
            <img src="/__mockup/images/map-bowie.png" alt="Bowie" className="w-8 h-8 rounded-full object-cover border border-zinc-700" />
            <div className="flex flex-col">
              <span className="text-[10px] text-white font-medium leading-none mb-1">David Bowie</span>
              <span className="text-[8px] text-zinc-500 map-mono">SIMILAR ARTIST</span>
            </div>
            <div className="w-4 h-4 ml-1 rounded bg-[#ef4444]/20 flex items-center justify-center text-[7px] text-[#ef4444] font-bold border border-[#ef4444]/30">LFM</div>
          </div>
        </div>
        
        {/* Expanded Similar */}
        <div className="absolute top-[85%] left-[85%] -translate-x-1/2 -translate-y-1/2 z-10 opacity-70 hover:opacity-100 transition-opacity">
          <div className="graph-node text-xs flex items-center gap-1.5 bg-zinc-900/60 border border-zinc-800 px-2 py-1 rounded-full cursor-pointer">
            <span className="text-zinc-300">Elton John</span>
          </div>
        </div>

        {/* Insight Node (Floating) */}
        <div className="absolute top-[80%] left-[45%] -translate-x-1/2 -translate-y-1/2 z-10">
          <div className="graph-node max-w-[200px] bg-yellow-950/20 backdrop-blur border border-yellow-900/30 p-2 rounded cursor-pointer relative">
            <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></div>
            <div className="text-[10px] text-yellow-500/80 font-medium mb-1 flex items-center gap-1">
              <Clock className="w-3 h-3" /> 0:48
            </div>
            <div className="text-[10px] text-zinc-300 leading-tight">
              The a cappella intro was layered from ~180 vocal overdubs.
            </div>
            <div className="mt-1.5 text-[8px] text-zinc-500 text-right">via Genius annotations</div>
          </div>
        </div>

        {/* Background texture/noise */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
      </div>

      {/* RIGHT: DOSSIER RAIL */}
      <div className="w-96 bg-zinc-950 border-l border-zinc-800 flex flex-col z-30 shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
        {/* Dossier Header */}
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-start justify-between mb-4">
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-500 map-mono uppercase tracking-wider mb-1">Entity Dossier</span>
              <h2 className="text-lg font-bold text-white leading-tight">Bohemian Rhapsody</h2>
              <p className="text-xs text-zinc-400 mt-1">Queen • 1975</p>
            </div>
            <button className="text-zinc-500 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="flex gap-2">
            <button className="flex-1 bg-white text-black py-1.5 rounded text-xs font-medium hover:bg-zinc-200 transition-colors flex items-center justify-center gap-1.5">
              <Play className="w-3 h-3 fill-black" /> Play
            </button>
            <button className="w-8 flex items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">
              <Share className="w-3 h-3" />
            </button>
            <button className="w-8 flex items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">
              <Bookmark className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Dossier Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* Identity & Core */}
          <section>
            <h3 className="text-[10px] text-zinc-500 map-mono uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Disc className="w-3 h-3" /> Identity
            </h3>
            <div className="space-y-2">
              <FactRow label="Title" value="Bohemian Rhapsody" source="WD" sourceColor="bg-zinc-800 text-zinc-300 border-zinc-700" />
              <FactRow label="Performer" value={<span className="text-blue-400 hover:underline cursor-pointer">Queen</span>} source="WD" sourceColor="bg-zinc-800 text-zinc-300 border-zinc-700" />
              <FactRow label="Released" value="31 Oct 1975" source="WD" sourceColor="bg-zinc-800 text-zinc-300 border-zinc-700" />
              <FactRow label="Length" value="5:55" source="Spotify" sourceColor="bg-green-950/50 text-green-500 border-green-900" />
            </div>
          </section>

          {/* Lineage & Credits */}
          <section>
            <h3 className="text-[10px] text-zinc-500 map-mono uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Users className="w-3 h-3" /> Provenance & Credits
            </h3>
            <div className="space-y-2">
              <FactRow 
                label="Producers" 
                value={
                  <div className="flex flex-col gap-1">
                    <span className="text-blue-400 hover:underline cursor-pointer">Roy Thomas Baker</span>
                    <span className="text-blue-400 hover:underline cursor-pointer">Queen</span>
                  </div>
                } 
                source="MB" 
                sourceColor="bg-pink-950/30 text-pink-500 border-pink-900/50" 
              />
              <FactRow 
                label="Writers" 
                value={<span className="text-blue-400 hover:underline cursor-pointer">Freddie Mercury</span>} 
                source="MB" 
                sourceColor="bg-pink-950/30 text-pink-500 border-pink-900/50" 
              />
              <FactRow 
                label="Recorded" 
                value={<span className="text-zinc-300">Aug–Sep 1975 (Rockfield, Roundhouse, SARM)</span>} 
                source="WD" 
                sourceColor="bg-zinc-800 text-zinc-300 border-zinc-700" 
              />
            </div>
          </section>

          {/* Sound & Classification */}
          <section>
            <h3 className="text-[10px] text-zinc-500 map-mono uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Radio className="w-3 h-3" /> Sound & Classification
            </h3>
            <div className="space-y-2">
              <FactRow 
                label="Genres" 
                value={
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-blue-400 hover:underline cursor-pointer">Progressive rock</span>,
                    <span className="text-blue-400 hover:underline cursor-pointer">Hard rock</span>,
                    <span className="text-blue-400 hover:underline cursor-pointer">Art rock</span>
                  </div>
                } 
                source="Last.fm" 
                sourceColor="bg-red-950/30 text-red-500 border-red-900/50" 
              />
              <FactRow 
                label="Pressing" 
                value={
                  <div>
                    <span className="text-blue-400 hover:underline cursor-pointer">EMI</span> <span className="text-zinc-400">7" single, UK, 1975</span>
                  </div>
                } 
                source="Discogs" 
                sourceColor="bg-orange-950/30 text-orange-500 border-orange-900/50" 
              />
            </div>
          </section>

          {/* External References */}
          <section>
            <h3 className="text-[10px] text-zinc-500 map-mono uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <LinkIcon className="w-3 h-3" /> Links & Deep Dive
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <a href="#" className="flex items-center justify-between p-2 rounded border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 transition-colors group">
                <span className="text-xs text-zinc-300 group-hover:text-white">Apple Music</span>
                <span className="text-[8px] bg-purple-950/30 text-purple-400 border border-purple-900/50 px-1 rounded">Odesli</span>
              </a>
              <a href="#" className="flex items-center justify-between p-2 rounded border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 transition-colors group">
                <span className="text-xs text-zinc-300 group-hover:text-white">YouTube</span>
                <span className="text-[8px] bg-purple-950/30 text-purple-400 border border-purple-900/50 px-1 rounded">Odesli</span>
              </a>
              <a href="#" className="flex items-center justify-between p-2 rounded border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 transition-colors group">
                <span className="text-xs text-zinc-300 group-hover:text-white">Lyrics</span>
                <span className="text-[8px] bg-yellow-950/30 text-yellow-500 border border-yellow-900/50 px-1 rounded">Genius</span>
              </a>
              <a href="#" className="flex items-center justify-between p-2 rounded border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 transition-colors group">
                <span className="text-xs text-zinc-300 group-hover:text-white">Artwork</span>
                <span className="text-[8px] bg-blue-950/30 text-blue-400 border border-blue-900/50 px-1 rounded">Commons</span>
              </a>
            </div>
          </section>

          {/* Empty state hint */}
          <div className="mt-8 pt-4 border-t border-zinc-800/50 flex items-start gap-2 text-zinc-500 opacity-60">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <p className="text-[10px] leading-relaxed">
              Track-level data may be incomplete. Values marked with an asterisk (*) are inferred from album-level facts.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}

function FactRow({ label, value, source, sourceColor }: { label: string, value: React.ReactNode, source: string, sourceColor: string }) {
  return (
    <div className="flex items-start group">
      <div className="w-24 text-[11px] text-zinc-500 pt-0.5">{label}</div>
      <div className="flex-1 text-[12px] text-zinc-200">
        <div className="flex items-start justify-between gap-2">
          <div>{value}</div>
          <div className={`text-[8px] font-bold px-1 py-0.5 rounded border opacity-50 group-hover:opacity-100 transition-opacity whitespace-nowrap ${sourceColor}`}>
            {source}
          </div>
        </div>
      </div>
    </div>
  );
}
