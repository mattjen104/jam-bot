import React, { useState } from 'react';
import './_group.css';
import { Play, SkipBack, SkipForward, Maximize2, ExternalLink, ArrowUpRight, Search, ChevronRight, Info } from 'lucide-react';

export function TheThread() {
  return (
    <div className="thread-theme flex flex-col relative pb-32">
      {/* Top Lineage Trail */}
      <header className="sticky top-0 z-50 bg-[#F4F1EA]/90 backdrop-blur-md border-b border-[#E6E2D8] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3 overflow-x-auto no-scrollbar font-mono text-xs text-[#8C867C]">
          <span className="shrink-0 flex items-center gap-1 hover:text-[#1F1D1A] cursor-pointer transition-colors">
            <span className="w-4 h-4 rounded-full bg-gray-300 inline-block overflow-hidden">
              <img src="https://upload.wikimedia.org/wikipedia/en/3/3c/Queen_Night_At_The_Opera.png" alt="A Night at the Opera" className="w-full h-full object-cover" />
            </span>
            A Night at the Opera
          </span>
          <ChevronRight size={14} className="opacity-50 shrink-0" />
          <span className="shrink-0 flex items-center gap-1 hover:text-[#1F1D1A] cursor-pointer transition-colors">
            <span className="w-4 h-4 rounded-full bg-gray-300 inline-block overflow-hidden">
              <img src="https://upload.wikimedia.org/wikipedia/commons/3/33/Queen_%E2%80%93_montagem.png" alt="Queen" className="w-full h-full object-cover" />
            </span>
            Queen
          </span>
          <ChevronRight size={14} className="opacity-50 shrink-0" />
          <span className="shrink-0 flex items-center gap-1 text-[#1F1D1A] font-bold border-b border-[#D33F33]">
            <span className="w-4 h-4 rounded-full bg-[#1F1D1A] text-white flex items-center justify-center text-[8px]">
              BR
            </span>
            Bohemian Rhapsody
          </span>
          
          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-2 border border-[#E6E2D8] rounded-full px-3 py-1.5 bg-white">
              <Search size={14} />
              <input type="text" placeholder="Explore graph..." className="bg-transparent outline-none w-32 placeholder:text-[#8C867C]" />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto w-full px-6 pt-12 pb-24 relative">
        {/* Main Entity Header */}
        <div className="mb-12 relative z-10">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-xs text-[#8C867C] uppercase tracking-wider">Record</span>
                <span className="provenance-chip chip-wd">WD</span>
                <span className="provenance-chip chip-sf">SF</span>
              </div>
              <h1 className="font-serif text-5xl font-bold tracking-tight mb-2">Bohemian Rhapsody</h1>
              <div className="flex items-center gap-3 text-xl text-[#8C867C]">
                by <span className="fact-door font-medium text-[#1F1D1A]">Queen <ArrowUpRight size={16} className="door-arrow" /></span>
                <span className="opacity-30">•</span>
                <span>1975</span>
                <span className="opacity-30">•</span>
                <span>5:55</span>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-xl overflow-hidden border border-[#E6E2D8] bg-white shadow-sm relative group">
            <img 
              src="/__mockup/images/thread-hero.png" 
              alt="1970s stage lights" 
              className="w-full h-64 object-cover filter contrast-125 saturate-50"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
            <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
              <div className="text-white/80 font-mono text-xs flex items-center gap-2">
                <span className="provenance-chip bg-white/20 text-white backdrop-blur-md">WC</span>
                Queen performing live, mid-1970s
              </div>
              <div className="text-white/50 font-mono text-[10px]">
                CC-BY · Wikimedia Commons
              </div>
            </div>
          </div>
        </div>

        {/* Fact Stack (The Evidence Wall) */}
        <div className="relative">
          <div className="connecting-line"></div>
          
          <div className="space-y-8 relative z-10">
            {/* Origins */}
            <FactCard 
              title="Origins" 
              sources={[
                { id: 'wd', label: 'WD', class: 'chip-wd' },
                { id: 'mb', label: 'MB', class: 'chip-mb' }
              ]}
            >
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <div className="text-xs font-mono text-[#8C867C] mb-1">Recorded</div>
                  <div className="text-sm">Aug–Sep 1975</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs font-mono text-[#8C867C] mb-1">Studios</div>
                  <div className="text-sm leading-relaxed">
                    <span className="fact-door">Rockfield <ArrowUpRight size={12} className="door-arrow" /></span>,{' '}
                    <span className="fact-door">Roundhouse <ArrowUpRight size={12} className="door-arrow" /></span>,{' '}
                    <span className="fact-door">SARM <ArrowUpRight size={12} className="door-arrow" /></span> & other UK studios
                  </div>
                </div>
                <div>
                  <div className="text-xs font-mono text-[#8C867C] mb-1">Country</div>
                  <div className="text-sm"><span className="fact-door">United Kingdom <ArrowUpRight size={12} className="door-arrow" /></span></div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs font-mono text-[#8C867C] mb-1">Part of Album</div>
                  <div className="text-sm">
                    <span className="fact-door italic font-medium">A Night at the Opera (1975) <ArrowUpRight size={12} className="door-arrow" /></span>
                  </div>
                </div>
              </div>
            </FactCard>

            {/* People & Credits */}
            <FactCard 
              title="Credits" 
              sources={[
                { id: 'mb', label: 'MB', class: 'chip-mb' },
                { id: 'dg', label: 'DG', class: 'chip-dg' }
              ]}
            >
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-1/3 text-xs font-mono text-[#8C867C] mt-1">Band Members</div>
                  <div className="w-2/3 space-y-2 text-sm">
                    <div className="flex justify-between items-baseline border-b border-[#E6E2D8]/50 pb-1">
                      <span className="fact-door font-medium">Freddie Mercury <ArrowUpRight size={12} className="door-arrow" /></span>
                      <span className="text-[#8C867C] text-xs">lead vocals, piano, songwriter</span>
                    </div>
                    <div className="flex justify-between items-baseline border-b border-[#E6E2D8]/50 pb-1">
                      <span className="fact-door font-medium">Brian May <ArrowUpRight size={12} className="door-arrow" /></span>
                      <span className="text-[#8C867C] text-xs">guitar, vocals</span>
                    </div>
                    <div className="flex justify-between items-baseline border-b border-[#E6E2D8]/50 pb-1">
                      <span className="fact-door font-medium">Roger Taylor <ArrowUpRight size={12} className="door-arrow" /></span>
                      <span className="text-[#8C867C] text-xs">drums, vocals</span>
                    </div>
                    <div className="flex justify-between items-baseline pb-1">
                      <span className="fact-door font-medium">John Deacon <ArrowUpRight size={12} className="door-arrow" /></span>
                      <span className="text-[#8C867C] text-xs">bass</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-4 pt-2">
                  <div className="w-1/3 text-xs font-mono text-[#8C867C] mt-1">Producers</div>
                  <div className="w-2/3 text-sm">
                    <span className="fact-door font-medium">Roy Thomas Baker <ArrowUpRight size={12} className="door-arrow" /></span> & <span className="fact-door font-medium">Queen <ArrowUpRight size={12} className="door-arrow" /></span>
                  </div>
                </div>
              </div>
            </FactCard>

            {/* Insight Note */}
            <div className="ml-12 border-l-2 border-[#D33F33] pl-4 py-1 relative">
              <div className="absolute -left-[29px] top-2 w-3 h-3 rounded-full bg-[#D33F33] border-4 border-[#F4F1EA]"></div>
              <div className="bg-[#FFF9E6] border border-[#E6E2D8] rounded-lg p-4 shadow-sm text-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-xs text-[#D33F33] font-bold">INSIGHT</span>
                  <span className="provenance-chip chip-gn">GN</span>
                </div>
                <p className="font-serif italic text-lg leading-relaxed text-[#1F1D1A]">
                  "0:48 — the a cappella intro was layered from ~180 vocal overdubs."
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button className="text-xs font-mono flex items-center gap-1 bg-white border border-[#E6E2D8] px-2 py-1 rounded text-[#1F1D1A] hover:bg-[#F4F1EA] transition-colors">
                    <Play size={10} /> Play Segment
                  </button>
                  <a href="#" className="text-xs text-[#8C867C] hover:text-[#1F1D1A] underline decoration-dotted flex items-center gap-1">
                    Read more on Genius <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            </div>

            {/* Sound & Recognition */}
            <FactCard 
              title="Sound & Status" 
              sources={[
                { id: 'lf', label: 'LF', class: 'chip-lf' },
                { id: 'wd', label: 'WD', class: 'chip-wd' }
              ]}
            >
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-xs font-mono text-[#8C867C] mb-2">Genres</div>
                  <div className="flex flex-wrap gap-2">
                    <span className="fact-door px-2 py-1 bg-[#F4F1EA] rounded text-sm hover:bg-[#D33F33] hover:text-white border-none">
                      progressive rock <ArrowUpRight size={12} className="door-arrow ml-1" />
                    </span>
                    <span className="fact-door px-2 py-1 bg-[#F4F1EA] rounded text-sm hover:bg-[#D33F33] hover:text-white border-none">
                      hard rock <ArrowUpRight size={12} className="door-arrow ml-1" />
                    </span>
                    <span className="fact-door px-2 py-1 bg-[#F4F1EA] rounded text-sm hover:bg-[#D33F33] hover:text-white border-none">
                      art rock <ArrowUpRight size={12} className="door-arrow ml-1" />
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-mono text-[#8C867C] mb-2">Recognition</div>
                  <ul className="space-y-1 text-sm list-disc pl-4 marker:text-[#8C867C]">
                    <li>Grammy Hall of Fame</li>
                    <li>UK Singles Chart #1 (twice)</li>
                    <li>Diamond certification (US)</li>
                  </ul>
                </div>
              </div>
            </FactCard>

            {/* Pressing */}
            <FactCard 
              title="First Pressing" 
              sources={[
                { id: 'dg', label: 'DG', class: 'chip-dg' }
              ]}
            >
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-[#1F1D1A] flex items-center justify-center shrink-0 border-4 border-[#F4F1EA] shadow-sm relative overflow-hidden">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-6 h-6 rounded-full bg-[#F4F1EA]"></div>
                  </div>
                  <div className="absolute top-1/2 left-0 w-full h-[1px] bg-white/20"></div>
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="fact-door font-medium">EMI <ArrowUpRight size={12} className="door-arrow" /></span>
                    <span className="text-sm text-[#8C867C]">7" single, UK, 1975</span>
                  </div>
                  <div className="text-sm text-[#8C867C]">
                    B-Side: <span className="fact-door">I'm in Love with My Car <ArrowUpRight size={12} className="door-arrow" /></span>
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-[10px] font-mono text-[#8C867C] bg-[#F4F1EA] inline-flex px-2 py-1 rounded">
                    <Info size={10} /> Label-level data; specific pressing may vary
                  </div>
                </div>
              </div>
            </FactCard>

            {/* Lineage / Related */}
            <FactCard 
              title="Lineage & Echoes" 
              sources={[
                { id: 'lf', label: 'LF', class: 'chip-lf' },
                { id: 'wd', label: 'WD', class: 'chip-wd' }
              ]}
            >
              <div className="space-y-6">
                <div>
                  <div className="text-xs font-mono text-[#8C867C] mb-3">Similar Artists (Explore)</div>
                  <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                    <LineageCard name="David Bowie" role="Glam/Art Rock" />
                    <LineageCard name="Elton John" role="Piano Rock" />
                    <LineageCard name="Mott the Hoople" role="Glam Rock" />
                  </div>
                </div>
                
                <div className="border-t border-[#E6E2D8] pt-4">
                  <div className="text-xs font-mono text-[#8C867C] mb-2">Legacy</div>
                  <div className="text-sm">
                    Sampled / referenced by <span className="fact-door font-medium">100+ artists <ArrowUpRight size={12} className="door-arrow" /></span> including "Weird Al" Yankovic, The Muppets, and heavily featured in the film <span className="fact-door italic">Wayne's World (1992) <ArrowUpRight size={12} className="door-arrow" /></span>.
                  </div>
                </div>
              </div>
            </FactCard>

            {/* Empty state hint */}
            <div className="ml-12 py-4">
              <div className="flex items-center gap-2 text-xs font-mono text-[#8C867C] opacity-60">
                <div className="w-1 h-1 rounded-full bg-[#8C867C]"></div>
                <div className="w-1 h-1 rounded-full bg-[#8C867C]"></div>
                <div className="w-1 h-1 rounded-full bg-[#8C867C]"></div>
                <span className="ml-2">End of structured track data.</span>
                <span className="fact-door ml-1">Explore album-level facts <ArrowUpRight size={10} className="door-arrow" /></span>
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* Persistent Spotify Anchor */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl bg-[#1F1D1A] rounded-2xl shadow-2xl border border-white/10 p-3 flex items-center gap-4 z-50 text-white backdrop-blur-xl bg-[#1F1D1A]/95">
        <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-gray-800">
          <img src="https://upload.wikimedia.org/wikipedia/en/3/3c/Queen_Night_At_The_Opera.png" alt="A Night at the Opera" className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-bold text-sm truncate">Bohemian Rhapsody</div>
            <span className="provenance-chip chip-sf text-[8px] px-1.5 py-0.5">Spotify</span>
          </div>
          <div className="text-xs text-white/60 truncate hover:text-white cursor-pointer transition-colors">Queen</div>
        </div>
        
        <div className="flex flex-col items-center gap-1 flex-1 max-w-[200px]">
          <div className="flex items-center gap-4">
            <button className="text-white/60 hover:text-white transition-colors"><SkipBack size={16} /></button>
            <button className="w-8 h-8 rounded-full bg-white text-[#1F1D1A] flex items-center justify-center hover:scale-105 transition-transform">
              <Play size={16} className="ml-0.5" />
            </button>
            <button className="text-white/60 hover:text-white transition-colors"><SkipForward size={16} /></button>
          </div>
          <div className="w-full flex items-center gap-2 text-[10px] text-white/40 font-mono">
            <span>0:48</span>
            <div className="h-1 flex-1 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white w-[15%] rounded-full relative">
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-white rounded-full"></div>
              </div>
            </div>
            <span>5:55</span>
          </div>
        </div>

        <div className="flex items-center gap-3 pl-4 border-l border-white/10">
          <div className="flex flex-col items-end gap-1">
            <span className="text-[8px] font-mono text-white/40 uppercase tracking-widest">Listen On</span>
            <div className="flex gap-1">
               <span className="w-4 h-4 rounded-sm bg-white/10 flex items-center justify-center text-[8px] hover:bg-white/20 cursor-pointer" title="Apple Music">AM</span>
               <span className="w-4 h-4 rounded-sm bg-white/10 flex items-center justify-center text-[8px] hover:bg-white/20 cursor-pointer" title="YouTube">YT</span>
               <span className="provenance-chip chip-od !text-[8px] !px-1">OD</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FactCard({ title, children, sources }: { title: string, children: React.ReactNode, sources: {id: string, label: string, class: string}[] }) {
  return (
    <div className="ml-12 bg-white border border-[#E6E2D8] rounded-xl p-6 shadow-sm relative group hover:border-[#8C867C] transition-colors">
      {/* Node connector dot */}
      <div className="absolute -left-[54px] top-8 w-3 h-3 rounded-full bg-[#1F1D1A] border-2 border-[#F4F1EA] z-10 group-hover:bg-[#D33F33] transition-colors"></div>
      
      <div className="flex justify-between items-start mb-4 pb-2 border-b border-[#E6E2D8]/50">
        <h3 className="font-serif font-semibold text-lg">{title}</h3>
        <div className="flex gap-1">
          {sources.map(s => (
            <span key={s.id} className={`provenance-chip ${s.class}`}>{s.label}</span>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}

function LineageCard({ name, role }: { name: string, role: string }) {
  return (
    <div className="min-w-[140px] border border-[#E6E2D8] rounded-lg p-3 bg-white hover:border-[#D33F33] cursor-pointer group transition-colors">
      <div className="w-10 h-10 rounded-full bg-gray-100 mb-2 flex items-center justify-center font-serif text-lg text-[#8C867C] group-hover:bg-[#FFF9E6] group-hover:text-[#D33F33] transition-colors">
        {name.charAt(0)}
      </div>
      <div className="font-medium text-sm truncate flex items-center gap-1 group-hover:text-[#D33F33]">
        {name} <ArrowUpRight size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="text-xs text-[#8C867C] truncate">{role}</div>
    </div>
  );
}
