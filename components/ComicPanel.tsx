import React from 'react';
import { ComicPanel as ComicPanelType } from '../types';

interface ComicPanelProps {
  panel: ComicPanelType;
}

// This component now acts as an overlay ON TOP of the generated image grid
export const ComicPanel: React.FC<ComicPanelProps> = ({ panel }) => {
  return (
    <div className="relative w-full h-full p-2 flex flex-col justify-between pointer-events-none group">
      
      {/* Hover Helper - shows panel ID faintly */}
      <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-50 text-[10px] text-white bg-black/50 px-1 rounded">
        #{panel.panelId}
      </div>

      {/* Narrator Box (Top) */}
      <div className="w-full flex justify-center items-start pt-1">
        {panel.narratorText && (
          <div className="bg-yellow-100/95 border-2 border-black px-2 py-1 text-xs md:text-sm font-bold text-gray-900 shadow-sm text-center max-w-[90%] pointer-events-auto">
            {panel.narratorText}
          </div>
        )}
      </div>

      {/* Speech Bubble (Bottom/Randomized slightly for organic feel) */}
      <div className={`w-full flex ${panel.panelId % 2 === 0 ? 'justify-end' : 'justify-start'} items-end pb-2`}>
        {panel.speechBubbleText && (
          <div className="relative bg-white/95 border-2 border-black rounded-xl px-3 py-2 shadow-md max-w-[85%] mx-2 mb-2 pointer-events-auto">
             {/* Tail direction based on panel side */}
             <div className={`absolute -bottom-2 ${panel.panelId % 2 === 0 ? 'right-4 border-r-2 border-b-2' : 'left-4 border-l-2 border-b-2'} w-3 h-3 bg-white border-black transform rotate-45`}></div>
             <p className="text-gray-900 font-bold text-sm md:text-base leading-tight comic-font">
               {panel.speechBubbleText}
             </p>
          </div>
        )}
      </div>
    </div>
  );
};