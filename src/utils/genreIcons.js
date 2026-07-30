import {
  MousePointerClick,
  HandFist,
  Swords,
  Crosshair,
  Music,
  ToyBrick,
  Puzzle,
  Car,
  Castle,
  Hourglass,
  ChessKnight,
  Target,
  Sword,
  Building2,
  Volleyball,
  HelpCircle,
  CircleDot,
  Compass,
  Sparkles,
  Joystick,
  BookOpen,
  Dices,
  Map as MapIcon,
  Gamepad2,
} from 'lucide-react'

/**
 * Maps an IGDB formal genre name to a lucide-react icon component, for the
 * "Haven't explored" tier's dashed grid on Your Gaming Map. Decorative only
 * — never a stand-in for real per-game art, so it carries no risk of
 * asserting anything false about a genre the user hasn't touched.
 *
 * Order matters — more specific patterns are checked before their broader
 * neighbors (e.g. "Real Time Strategy (RTS)" hits its own rule before the
 * generic "Strategy" rule could claim it).
 */
const GENRE_ICON_RULES = [
  [/point-and-click/i, MousePointerClick],
  [/hack and slash|beat.?em.?up/i, HandFist],
  [/fighting/i, Swords],
  [/shooter/i, Crosshair],
  [/\bmusic\b/i, Music],
  [/\bplatform/i, ToyBrick],
  [/puzzle/i, Puzzle],
  [/racing/i, Car],
  [/real time strategy/i, Castle],
  [/turn-based strategy/i, Hourglass],
  [/\bstrategy\b/i, ChessKnight],
  [/tactical/i, Target],
  [/role-?playing|\brpg\b/i, Sword],
  [/simulat/i, Building2],
  [/\bsport\b/i, Volleyball],
  [/quiz|trivia/i, HelpCircle],
  [/pinball/i, CircleDot],
  [/adventure/i, Compass],
  [/indie/i, Sparkles],
  [/arcade/i, Joystick],
  [/visual novel/i, BookOpen],
  [/card.*board|board.*game/i, Dices],
  [/moba/i, MapIcon],
]

/** @returns {React.ComponentType} a lucide-react icon component */
export function genreIcon(genreName) {
  if (!genreName) return Gamepad2
  const match = GENRE_ICON_RULES.find(([re]) => re.test(genreName))
  return match ? match[1] : Gamepad2
}
