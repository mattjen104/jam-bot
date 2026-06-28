import React from 'react';
import './TheCaseFile.css';
import { Play, Pause, SkipBack, SkipForward, Volume2, ArrowUpRight, Search, Menu, Maximize2 } from 'lucide-react';

export function TheCaseFile() {
  return (
    <div className="case-file-wrapper w-full min-h-screen selection:bg-[#d32f2f] selection:text-white">
      {/* Top Navbar */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-8 py-4 bg-[#f4f1ea]/90 backdrop-blur-sm border-b border-[#d4d0c5]">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-black text-white flex items-center justify-center font-bold case-font-mono text-sm tracking-tighter">
            MG
          </div>
          <span className="case-font-mono text-xs tracking-widest text-[#8b8982]">DOSSIER-PRIMARY // 1975-QR-BR</span>
        </div>
        <div className="flex items-center gap-6 text-[#8b8982]">
          <Search className="w-4 h-4 cursor-pointer hover:text-black transition-colors" />
          <Menu className="w-4 h-4 cursor-pointer hover:text-black transition-colors" />
        </div>
      </nav>

      {/* Hero Media Band */}
      <header className="relative w-full h-[50vh] min-h-[400px] max-h-[600px] overflow-hidden bg-black">
        <img 
          src="/__mockup/images/vintage-concert-haze.png" 
          alt="Concert stage lights" 
          className="w-full h-full object-cover opacity-70"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
        
        <div className="absolute bottom-0 left-0 w-full p-8 md:p-16 flex flex-col md:flex-row items-end justify-between gap-8 text-white">
          <div className="max-w-3xl">
            <h1 className="text-5xl md:text-7xl font-bold mb-2 leading-tight">
              Bohemian Rhapsody
            </h1>
            <div className="flex items-center gap-4 text-xl md:text-2xl text-white/80">
              <span className="case-door text-white hover:text-[#d32f2f]">
                Queen
                <ArrowUpRight className="w-5 h-5 case-door-arrow" />
              </span>
              <span className="opacity-50">·</span>
              <span className="case-font-mono text-lg">1975</span>
            </div>
          </div>

          {/* Persistant Spotify Anchor Mockup */}
          <div className="spotify-dock w-full md:w-80 flex-shrink-0 z-20">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-zinc-800 rounded flex items-center justify-center overflow-hidden">
                 <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-900" />
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="text-sm font-semibold truncate">Bohemian Rhapsody</div>
                <div className="text-xs text-gray-400 truncate hover:underline cursor-pointer">Queen</div>
              </div>
              <div className="flex items-center gap-2">
                 <span className="prov-chip prov-sp scale-75 origin-right">Spotify</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>0:48</span>
                <div className="flex-1 mx-2 h-1 bg-zinc-700 rounded-full overflow-hidden relative">
                   <div className="absolute top-0 left-0 h-full w-[15%] bg-white rounded-full"></div>
                </div>
                <span>5:55</span>
              </div>
              <div className="flex items-center justify-center gap-4 mt-2">
                <SkipBack className="w-4 h-4 text-gray-400 hover:text-white cursor-pointer" />
                <button className="w-8 h-8 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform text-black pl-1">
                  <Play className="w-4 h-4" />
                </button>
                <SkipForward className="w-4 h-4 text-gray-400 hover:text-white cursor-pointer" />
              </div>
            </div>
          </div>
        </div>

        <div className="absolute top-4 right-4 case-font-mono text-[10px] text-white/50 flex items-center gap-2">
          <span>MEDIA: COMMONS · CC-BY</span>
          <span className="prov-chip prov-co">Commons</span>
        </div>
      </header>

      {/* Main Dossier Content */}
      <main className="max-w-5xl mx-auto px-8 md:px-16 py-12 grid grid-cols-1 md:grid-cols-12 gap-12">
        
        {/* Left Column: Facts */}
        <div className="md:col-span-8 space-y-12">
          
          {/* Section: Identity */}
          <section className="dossier-section">
            <div className="dossier-label">
              Identity <span className="prov-chip prov-wd">WD</span>
            </div>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8 text-lg">
              <div>
                <div className="text-xs case-font-mono text-[#8b8982] mb-1">TITLE</div>
                <div>Bohemian Rhapsody</div>
              </div>
              <div>
                <div className="text-xs case-font-mono text-[#8b8982] mb-1">PERFORMER</div>
                <div>
                  <span className="case-door">Queen <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
                </div>
              </div>
              <div>
                <div className="text-xs case-font-mono text-[#8b8982] mb-1">LENGTH</div>
                <div className="case-font-mono">5:55</div>
              </div>
              <div>
                <div className="text-xs case-font-mono text-[#8b8982] mb-1">RELEASED</div>
                <div className="case-font-mono">31 Oct 1975</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs case-font-mono text-[#8b8982] mb-1">PART OF ALBUM</div>
                <div>
                  <span className="case-door">A Night at the Opera (1975) <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
                </div>
              </div>
            </div>
          </section>

          {/* Section: Origins */}
          <section className="dossier-section">
            <div className="dossier-label">
              Origins <span className="prov-chip prov-mb">MB</span>
            </div>
            <div className="text-lg leading-relaxed">
              Recorded <span className="case-font-mono text-base">Aug–Sep 1975</span> across 
              <span className="case-door mx-1">Rockfield <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>, 
              <span className="case-door mx-1">Roundhouse <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>, 
              <span className="case-door mx-1">SARM <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span> 
              & other <span className="case-door mx-1">United Kingdom <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span> studios.
            </div>
          </section>

          {/* Section: People / Credits */}
          <section className="dossier-section">
            <div className="dossier-label">
              People & Credits <span className="prov-chip prov-mb">MB</span>
            </div>
            <div className="space-y-4 text-lg">
              <div className="flex flex-col sm:flex-row sm:items-baseline gap-2">
                <span className="case-door font-bold min-w-[200px]">Freddie Mercury <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
                <span className="text-[#8b8982] case-font-mono text-sm">lead vocals, piano, songwriter</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-baseline gap-2">
                <span className="case-door font-bold min-w-[200px]">Brian May <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
                <span className="text-[#8b8982] case-font-mono text-sm">guitar, vocals</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-baseline gap-2">
                <span className="case-door font-bold min-w-[200px]">Roger Taylor <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
                <span className="text-[#8b8982] case-font-mono text-sm">drums, vocals</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-baseline gap-2">
                <span className="case-door font-bold min-w-[200px]">John Deacon <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
                <span className="text-[#8b8982] case-font-mono text-sm">bass</span>
              </div>
              <div className="mt-6 pt-4 border-t border-dashed border-[#d4d0c5]">
                <div className="text-xs case-font-mono text-[#8b8982] mb-2">PRODUCERS</div>
                <div className="flex gap-4">
                  <span className="case-door">Roy Thomas Baker <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
                  <span className="case-door">Queen <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
                </div>
              </div>
            </div>
          </section>

          {/* Section: Sound */}
          <section className="dossier-section">
            <div className="dossier-label">
              Sound <span className="prov-chip prov-lf">LF</span> <span className="prov-chip prov-wd">WD</span>
            </div>
            <div className="mb-6">
              <div className="text-xs case-font-mono text-[#8b8982] mb-2">GENRES</div>
              <div className="flex flex-wrap gap-3 text-lg">
                <span className="case-door">progressive rock <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
                <span className="text-[#d4d0c5]">•</span>
                <span className="case-door">hard rock <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
                <span className="text-[#d4d0c5]">•</span>
                <span className="case-door">art rock <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
              </div>
            </div>
            
            {/* Timed Insight Callout */}
            <div className="bg-white p-6 border border-[#d4d0c5] shadow-sm relative">
              <div className="absolute top-0 left-0 w-1 h-full bg-[#d32f2f]"></div>
              <div className="flex items-start gap-4">
                <div className="case-font-mono font-bold text-[#d32f2f] bg-[#f4f1ea] px-2 py-1 text-sm border border-[#d4d0c5]">
                  0:48
                </div>
                <div>
                  <p className="text-lg italic">
                    "The a cappella intro was layered from ~180 vocal overdubs, pushing the limits of 24-track analog tape."
                  </p>
                  <div className="mt-2 text-xs case-font-mono text-[#8b8982] flex items-center gap-2">
                    INSIGHT RECORDING <span className="prov-chip prov-wd">WD</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section: Pressing */}
          <section className="dossier-section">
            <div className="dossier-label">
              Pressing <span className="prov-chip prov-di">DI</span>
            </div>
            <div className="flex items-center gap-4 text-lg">
              <span className="case-door font-bold">EMI <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
              <span className="case-font-mono text-sm text-[#8b8982]">7" single, UK, 1975</span>
            </div>
            <div className="mt-2 text-[#8b8982] italic">
              b-side: <span className="case-door not-italic text-black">I'm in Love with My Car <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
            </div>
            <div className="mt-4 text-xs case-font-mono text-[#8b8982] bg-[#e8e6df] p-2 inline-block">
              * Showing approximate label-level data. Exact pressing variations extensive.
            </div>
          </section>

          {/* Section: Lineage */}
          <section className="dossier-section border-none">
            <div className="dossier-label">
              Lineage <span className="prov-chip prov-lf">LF</span> <span className="prov-chip prov-wd">WD</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 text-lg">
              <div>
                <div className="text-xs case-font-mono text-[#8b8982] mb-3 border-b border-[#d4d0c5] pb-2">SIMILAR ARTISTS</div>
                <ul className="space-y-3">
                  <li><span className="case-door">David Bowie <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span></li>
                  <li><span className="case-door">Elton John <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span></li>
                  <li><span className="case-door">Mott the Hoople <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span></li>
                </ul>
              </div>
              <div>
                <div className="text-xs case-font-mono text-[#8b8982] mb-3 border-b border-[#d4d0c5] pb-2">REFERENCED IN</div>
                <ul className="space-y-3">
                  <li><span className="case-door text-black/60 italic">Track-level references sparse <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span></li>
                  <li className="text-sm case-font-mono text-[#8b8982] mt-2 bg-white/50 p-2 rounded">
                    Data unavailable at track level. Try exploring artist lineage.
                  </li>
                </ul>
              </div>
            </div>
          </section>

        </div>

        {/* Right Column: Minimap / Sidebar */}
        <div className="md:col-span-4 relative">
          <div className="sticky top-24 space-y-8">
            
            {/* Minimap Box */}
            <div className="bg-white border border-[#d4d0c5] shadow-sm p-1">
              <div className="bg-[#f4f1ea] aspect-square relative overflow-hidden group cursor-pointer border border-[#d4d0c5]">
                {/* Fake graph nodes */}
                <div className="absolute inset-0 opacity-40">
                  <svg className="w-full h-full" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="3" fill="#000" />
                    <line x1="50" y1="50" x2="20" y2="30" stroke="#8b8982" strokeWidth="0.5" />
                    <circle cx="20" cy="30" r="2" fill="#d32f2f" />
                    <line x1="50" y1="50" x2="80" y2="40" stroke="#8b8982" strokeWidth="0.5" />
                    <circle cx="80" cy="40" r="2" fill="#8b8982" />
                    <line x1="50" y1="50" x2="60" y2="80" stroke="#8b8982" strokeWidth="0.5" />
                    <circle cx="60" cy="80" r="2" fill="#8b8982" />
                    <line x1="50" y1="50" x2="30" y2="70" stroke="#8b8982" strokeWidth="0.5" />
                    <circle cx="30" cy="70" r="1.5" fill="#8b8982" />
                  </svg>
                </div>
                <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[1px]">
                  <div className="bg-white px-3 py-2 text-xs case-font-mono font-bold flex items-center gap-2 shadow-sm">
                    <Maximize2 className="w-3 h-3" /> ROAM MODE
                  </div>
                </div>
              </div>
              <div className="p-3 text-center">
                <div className="text-xs case-font-mono text-[#8b8982]">GRAPH TOPOLOGY</div>
              </div>
            </div>

            {/* Recognition & Elsewhere */}
            <div className="space-y-6">
              <div>
                <div className="dossier-label border-b border-[#d4d0c5] pb-2">Recognition</div>
                <ul className="space-y-2 mt-3 text-lg">
                  <li className="flex items-center gap-2">
                    <span className="text-[#d32f2f]">★</span> 
                    <span className="case-door">Grammy Hall of Fame <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-[#d32f2f]">★</span> 
                    <span className="case-door">UK #1 <ArrowUpRight className="w-4 h-4 case-door-arrow" /></span>
                  </li>
                </ul>
              </div>

              <div>
                <div className="dossier-label border-b border-[#d4d0c5] pb-2">
                  Elsewhere <span className="prov-chip prov-od ml-auto">OD</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {['Apple Music', 'YouTube', 'Tidal', 'Deezer', 'Amazon'].map(platform => (
                    <span key={platform} className="text-xs case-font-mono border border-[#d4d0c5] px-2 py-1 bg-white hover:border-[#d32f2f] hover:text-[#d32f2f] cursor-pointer transition-colors">
                      {platform} ↗
                    </span>
                  ))}
                  <span className="text-xs case-font-mono border border-[#d4d0c5] px-2 py-1 bg-white hover:border-[#d32f2f] hover:text-[#d32f2f] cursor-pointer transition-colors">
                    Lyrics <span className="prov-chip prov-ge ml-1 scale-75 origin-left">GE</span>
                  </span>
                </div>
              </div>
            </div>

          </div>
        </div>

      </main>
      
      {/* Footer */}
      <footer className="border-t border-[#d4d0c5] p-8 text-center case-font-mono text-xs text-[#8b8982]">
        MUSIC GRAPH // PROVENANCE ENGINE
      </footer>
    </div>
  );
}
