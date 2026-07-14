'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useLang } from '@/lib/i18n/use-lang'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { GAMES } from '@/lib/game/games'
import { CAMPAIGNS } from '@/lib/game/campaigns'
import { getSpecies, getClasses, getBackgrounds, ABILITY_LABELS } from '@/lib/game/srd-data'
import { rollAbilityScoreSet, STANDARD_ARRAY } from '@/lib/game/dice'
import { assembleCharacter } from '@/lib/game/assemble-character'
import { abilityMod, formatMod } from '@/lib/game/derive'
import type { PregenCharacter } from '@/lib/game/pregens'
import type { AbilityId, SpeciesData, ClassData, BackgroundData } from '@/lib/game/srd-types'
import type { Character } from '@/lib/types'

type WizardStep =
  | 'game_select' | 'campaign_select' | 'character_method' | 'pregen_select' | 'pregen_customize'
  | 'name' | 'species' | 'class' | 'subclass' | 'background' | 'skills' | 'ability_scores' | 'spells' | 'review'

type PronounChoice = 'he/him' | 'she/her' | 'they/them' | 'custom' | ''

type DraftCharacter = Omit<Character, 'id' | 'user_id'>

const ABILITY_ORDER: AbilityId[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

const C = {
  bg: '#0f0d09', mid: '#1a1610', lt: '#241f17', cd: '#1e1912', go: '#c9952a', gp: '#e8d090',
  ink: '#f0ead8', dim: '#b8a878', ft: '#7a6840', re: '#9b2318', rl: '#c8392b', gr: '#2a6b3a',
  gl: '#3d9954', br: '#3a3020',
}

const cardStyle = (active: boolean, disabled?: boolean): React.CSSProperties => ({
  background: active ? 'rgba(42,107,58,.12)' : C.cd,
  border: `2px solid ${active ? C.gl : C.br}`,
  padding: '14px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.4 : 1,
  transition: 'border-color .15s',
})

const sectionLabel: React.CSSProperties = {
  fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '2px', color: C.ft,
  textTransform: 'uppercase', marginBottom: '6px', marginTop: '14px',
}

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase',
  padding: '12px 20px', background: disabled ? '#1a3020' : C.gr, border: `2px solid ${disabled ? '#284a30' : C.gl}`,
  color: disabled ? '#5a7a60' : '#fff', cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 600,
})

const secondaryBtn: React.CSSProperties = {
  fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase',
  padding: '12px 20px', background: 'transparent', border: `1px solid ${C.br}`, color: C.dim, cursor: 'pointer',
}

export default function NewGamePage() {
  const router = useRouter()
  const lang = useLang()
  const dict = getDictionary(lang)
  const d = dict.newGame

  const speciesMap = getSpecies(lang) as Record<string, SpeciesData>
  const classMap = getClasses(lang) as Record<string, ClassData>
  const backgroundMap = getBackgrounds(lang) as Record<string, BackgroundData>
  const al = ABILITY_LABELS[lang]

  const [step, setStep] = useState<WizardStep>('game_select')
  const [path, setPath] = useState<'pregen' | 'custom' | null>(null)

  const [pregens, setPregens] = useState<PregenCharacter[]>([])
  const pregensFetchedRef = useRef(false)
  const [selectedPregenId, setSelectedPregenId] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [speciesId, setSpeciesId] = useState<string | null>(null)
  const [subraceId, setSubraceId] = useState<string | null>(null)
  const [classId, setClassId] = useState<string | null>(null)
  const [subclassId, setSubclassId] = useState<string | null>(null)
  const [backgroundId, setBackgroundId] = useState<string | null>(null)

  const [abilityMethod, setAbilityMethod] = useState<'standard' | 'roll'>('standard')
  const [rolledValues, setRolledValues] = useState<number[]>([])
  const [rollsUsed, setRollsUsed] = useState(0)
  const [assignment, setAssignment] = useState<Partial<Record<AbilityId, number>>>({})
  const [bonusPrimary, setBonusPrimary] = useState<AbilityId | ''>('')
  const [bonusSecondary, setBonusSecondary] = useState<AbilityId | ''>('')

  const [selectedSkills, setSelectedSkills] = useState<string[]>([])

  const [pronounsChoice, setPronounsChoice] = useState<PronounChoice>('')
  const [customPronouns, setCustomPronouns] = useState('')

  const [cantrips, setCantrips] = useState<string[]>([])
  const [spellsKnown, setSpellsKnown] = useState<string[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const selectedClass = classId ? classMap[classId] : null
  const selectedSpecies = speciesId ? speciesMap[speciesId] : null
  const selectedBackground = backgroundId ? backgroundMap[backgroundId] : null
  const hasSubclass = !!selectedClass?.subclass_at_1
  const isCaster = !!selectedClass?.is_caster

  const customSteps: WizardStep[] = useMemo(() => [
    'game_select', 'campaign_select', 'character_method',
    'name', 'species', 'class',
    ...(hasSubclass ? ['subclass' as const] : []),
    'background', 'skills', 'ability_scores',
    ...(isCaster ? ['spells' as const] : []),
    'review',
  ], [hasSubclass, isCaster])

  const pregenSteps: WizardStep[] = ['game_select', 'campaign_select', 'character_method', 'pregen_select', 'pregen_customize', 'review']
  const stepList = path === 'pregen' ? pregenSteps : customSteps

  // fetch pregens when entering that step
  useEffect(() => {
    if (step !== 'pregen_select' || pregensFetchedRef.current) return
    pregensFetchedRef.current = true
    fetch(`/api/characters/pregenerated?lang=${lang}`)
      .then(res => res.json())
      .then(json => setPregens(json.characters || []))
  }, [step, lang])

  // Reset dependent selections during render when their parent choice changes
  // (React's recommended alternative to an effect for this exact case).
  const [prevSpeciesId, setPrevSpeciesId] = useState(speciesId)
  if (speciesId !== prevSpeciesId) {
    setPrevSpeciesId(speciesId)
    setSubraceId(null)
  }

  const [prevClassId, setPrevClassId] = useState(classId)
  if (classId !== prevClassId) {
    setPrevClassId(classId)
    setSubclassId(null)
    setCantrips([])
    setSpellsKnown([])
    setSelectedSkills([])
  }

  const [prevBackgroundId, setPrevBackgroundId] = useState(backgroundId)
  if (backgroundId !== prevBackgroundId) {
    setPrevBackgroundId(backgroundId)
    setSelectedSkills([])
    setBonusPrimary('')
    setBonusSecondary('')
  }

  const [prevAbilityMethod, setPrevAbilityMethod] = useState(abilityMethod)
  if (abilityMethod !== prevAbilityMethod) {
    setPrevAbilityMethod(abilityMethod)
    setAssignment({})
  }

  const [prevSelectedPregenId, setPrevSelectedPregenId] = useState(selectedPregenId)
  if (selectedPregenId !== prevSelectedPregenId) {
    setPrevSelectedPregenId(selectedPregenId)
    const p = pregens.find(pg => pg.pregen_id === selectedPregenId)
    setName(p ? p.name : '')
    setPronounsChoice('')
    setCustomPronouns('')
  }

  // Default spell selection once entering the spells step for the first time
  const [prevStep, setPrevStep] = useState(step)
  if (step !== prevStep) {
    setPrevStep(step)
    if (step === 'spells' && selectedClass?.is_caster) {
      if (cantrips.length === 0 && (selectedClass.cantrip_list?.length || 0) > 0) {
        setCantrips((selectedClass.cantrip_list || []).slice(0, selectedClass.cantrips_known || 0))
      }
      if (spellsKnown.length === 0 && (selectedClass.spell_list_at_1?.length || 0) > 0) {
        setSpellsKnown((selectedClass.spell_list_at_1 || []).slice(0, selectedClass.spells_known_at_1 || 0))
      }
    }
  }

  const sourceValues = abilityMethod === 'standard' ? STANDARD_ARRAY : rolledValues
  const usedIndices = new Set(Object.values(assignment).filter((v): v is number => v !== undefined))

  const baseScores: Record<AbilityId, number> | null = useMemo(() => {
    if (!ABILITY_ORDER.every(k => assignment[k] !== undefined)) return null
    const out = {} as Record<AbilityId, number>
    ABILITY_ORDER.forEach(k => { out[k] = sourceValues[assignment[k]!] })
    return out
  }, [assignment, sourceValues])

  const draftCharacter: DraftCharacter | null = useMemo(() => {
    if (!speciesId || !classId || !backgroundId || !baseScores || !bonusPrimary || !bonusSecondary) return null
    try {
      return assembleCharacter({
        lang, name: name.trim() || '—', speciesId, subraceId, classId, subclassId, backgroundId,
        abilityScores: baseScores, bonusPrimary, bonusSecondary, chosenSkills: selectedSkills,
        cantrips, spellsKnown, campaign: 'five_oaks',
      })
    } catch { return null }
  }, [lang, name, speciesId, subraceId, classId, subclassId, backgroundId, baseScores, bonusPrimary, bonusSecondary, selectedSkills, cantrips, spellsKnown])

  const selectedPregen = pregens.find(p => p.pregen_id === selectedPregenId) || null
  const pronounsFinal = pronounsChoice === 'custom' ? customPronouns.trim() : pronounsChoice
  const customizedPregen: DraftCharacter | null = selectedPregen
    ? { ...selectedPregen, name: name.trim() || selectedPregen.name, pronouns: pronounsFinal || undefined }
    : null
  const reviewCharacter: DraftCharacter | null = path === 'pregen' ? customizedPregen : draftCharacter

  function goNext() {
    const idx = stepList.indexOf(step)
    if (idx >= 0 && idx < stepList.length - 1) setStep(stepList[idx + 1])
  }
  function goBack() {
    const idx = stepList.indexOf(step)
    if (idx > 0) setStep(stepList[idx - 1])
    else router.push(`/${lang}/play`)
  }

  function isStepValid(): boolean {
    switch (step) {
      case 'game_select': return true
      case 'campaign_select': return true
      case 'character_method': return path !== null
      case 'pregen_select': return !!selectedPregenId
      case 'pregen_customize': { const n = name.trim().length; return n >= 2 && n <= 40 }
      case 'name': return name.trim().length > 0
      case 'species': return !!speciesId && (!selectedSpecies?.subraces || !!subraceId)
      case 'class': return !!classId
      case 'subclass': return !!subclassId
      case 'background': return !!backgroundId
      case 'skills': return !!selectedClass && selectedSkills.length === selectedClass.skill_choices.count
      case 'ability_scores': return !!baseScores && !!bonusPrimary && !!bonusSecondary
      case 'spells': return true
      case 'review': return true
      default: return false
    }
  }

  async function handleSubmit() {
    if (!reviewCharacter) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reviewCharacter),
      })
      const json = await res.json()
      if (!res.ok || !json.character) throw new Error(json.error || 'Failed to create character')
      router.push(`/${lang}/play?charId=${json.character.id}`)
    } catch (e) {
      setSubmitError((e as Error).message)
      setSubmitting(false)
    }
  }

  function toggleCantrip(spellName: string) {
    setCantrips(prev => {
      if (prev.includes(spellName)) return prev.filter(x => x !== spellName)
      if (prev.length >= (selectedClass?.cantrips_known || 0)) return prev
      return [...prev, spellName]
    })
  }
  function toggleSpell(spellName: string) {
    setSpellsKnown(prev => {
      if (prev.includes(spellName)) return prev.filter(x => x !== spellName)
      if (prev.length >= (selectedClass?.spells_known_at_1 || 0)) return prev
      return [...prev, spellName]
    })
  }
  function toggleSkill(skill: string) {
    setSelectedSkills(prev => {
      if (prev.includes(skill)) return prev.filter(x => x !== skill)
      if (prev.length >= (selectedClass?.skill_choices.count || 0)) return prev
      return [...prev, skill]
    })
  }

  // ── Step content renderers ──────────────────────────────────────────────

  function GameSelectStep() {
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{d.gameSelect.title}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
          {GAMES.map(g => (
            <div key={g.id} style={cardStyle(g.active, !g.active)}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', color: g.active ? C.go : C.ft, marginBottom: '4px' }}>{g.name}</div>
              <div style={{ fontSize: '11px', color: C.dim }}>{g.active ? g.tagline[lang] : d.gameSelect.comingSoon}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  function CampaignSelectStep() {
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{d.campaignSelect.title}</div>
        {CAMPAIGNS.map(c => (
          <div key={c.id} style={cardStyle(true)}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', color: C.go, marginBottom: '6px' }}>{c.name[lang]}</div>
            <div style={{ fontSize: '12px', color: C.dim, lineHeight: 1.6, marginBottom: '8px' }}>{c.description[lang]}</div>
            <div style={{ display: 'flex', gap: '10px', fontFamily: "'Cinzel', serif", fontSize: '9px', color: C.ft, textTransform: 'uppercase', letterSpacing: '1px' }}>
              <span>{d.campaignSelect.level}: {c.levelRange}</span>
              <span>{d.campaignSelect.length}: {c.sessions[lang]}</span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  function CharacterMethodStep() {
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{d.method.title}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
          <div style={cardStyle(path === 'pregen')} onClick={() => setPath('pregen')}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', color: C.go, marginBottom: '6px' }}>{d.method.pregenTitle}</div>
            <div style={{ fontSize: '12px', color: C.dim, lineHeight: 1.5 }}>{d.method.pregenDesc}</div>
          </div>
          <div style={cardStyle(path === 'custom')} onClick={() => setPath('custom')}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', color: C.go, marginBottom: '6px' }}>{d.method.customTitle}</div>
            <div style={{ fontSize: '12px', color: C.dim, lineHeight: 1.5 }}>{d.method.customDesc}</div>
          </div>
        </div>
      </div>
    )
  }

  function PregenSelectStep() {
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{d.pregenSelect.title}</div>
        {pregens.length === 0 && <div style={{ color: C.dim, fontSize: '12px' }}>{dict.common.loading}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
          {pregens.map(p => {
            const cls = classMap[p.class]
            const spec = speciesMap[p.species]
            return (
              <div key={p.pregen_id} style={cardStyle(selectedPregenId === p.pregen_id)} onClick={() => setSelectedPregenId(p.pregen_id)}>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', color: C.go, marginBottom: '2px' }}>{p.name}</div>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', color: C.rl, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px' }}>
                  {cls?.name} · {spec?.name}
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  <span style={{ background: C.lt, border: `1px solid ${C.br}`, padding: '3px 8px', fontSize: '11px' }}>{d.pregenSelect.hp} {p.hp_max}</span>
                  <span style={{ background: C.lt, border: `1px solid ${C.br}`, padding: '3px 8px', fontSize: '11px' }}>{d.pregenSelect.ac} {p.ac}</span>
                </div>
                <div style={{ fontSize: '11px', color: C.dim, fontStyle: 'italic' }}>{cls?.playstyle}</div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function PregenCustomizeStep() {
    if (!selectedPregen) return null
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{d.pregenCustomize.title}</div>

        <div style={sectionLabel}>{d.pregenCustomize.nameLabel}</div>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={selectedPregen.name}
          maxLength={40}
          style={{ width: '100%', fontFamily: "'Crimson Pro', serif", fontSize: '16px', padding: '12px', background: C.lt, border: `1px solid ${C.br}`, color: C.ink, outline: 'none', boxSizing: 'border-box', marginBottom: '6px' }}
        />
        <div style={{ fontSize: '11px', color: C.ft, marginBottom: '16px' }}>{d.pregenCustomize.nameHint}</div>

        <div style={sectionLabel}>{d.pregenCustomize.pronounsLabel}</div>
        <select
          value={pronounsChoice}
          onChange={e => setPronounsChoice(e.target.value as PronounChoice)}
          style={{ width: '100%', background: C.lt, border: `1px solid ${C.br}`, color: C.ink, padding: '10px', fontSize: '14px', marginBottom: '10px' }}
        >
          <option value="">—</option>
          <option value="he/him">{d.pregenCustomize.pronounsHeHim}</option>
          <option value="she/her">{d.pregenCustomize.pronounsSheHer}</option>
          <option value="they/them">{d.pregenCustomize.pronounsTheyThem}</option>
          <option value="custom">{d.pregenCustomize.pronounsCustom}</option>
        </select>
        {pronounsChoice === 'custom' && (
          <input
            value={customPronouns}
            onChange={e => setCustomPronouns(e.target.value)}
            placeholder={d.pregenCustomize.customPlaceholder}
            style={{ width: '100%', fontFamily: "'Crimson Pro', serif", fontSize: '14px', padding: '10px', background: C.lt, border: `1px solid ${C.br}`, color: C.ink, outline: 'none', boxSizing: 'border-box' }}
          />
        )}
      </div>
    )
  }

  function NameStep() {
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{d.name.title}</div>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={d.name.placeholder}
          style={{ width: '100%', fontFamily: "'Crimson Pro', serif", fontSize: '16px', padding: '12px', background: C.lt, border: `1px solid ${C.br}`, color: C.ink, outline: 'none', boxSizing: 'border-box' }}
        />
      </div>
    )
  }

  function SpeciesStep() {
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{d.species.title}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
          {Object.entries(speciesMap).map(([id, sp]) => (
            <div key={id} style={cardStyle(speciesId === id)} onClick={() => setSpeciesId(id)}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', color: C.go, marginBottom: '4px' }}>{sp.name}</div>
              <div style={{ fontSize: '11px', color: C.dim, lineHeight: 1.5, marginBottom: '6px' }}>{sp.description}</div>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', color: C.ft }}>{d.species.speed}: {sp.speed}ft · {d.species.size}: {sp.size}</div>
            </div>
          ))}
        </div>

        {selectedSpecies?.subraces && (
          <>
            <div style={sectionLabel}>{d.species.subraceTitle}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
              {Object.entries(selectedSpecies.subraces).map(([id, sub]) => (
                <div key={id} style={cardStyle(subraceId === id)} onClick={() => setSubraceId(id)}>
                  <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', color: C.go, marginBottom: '4px' }}>{sub.name}</div>
                  <div style={{ fontSize: '11px', color: C.dim, lineHeight: 1.5 }}>{sub.extra}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  function ClassStep() {
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{d.classStep.title}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
          {Object.entries(classMap).map(([id, cls]) => (
            <div key={id} style={cardStyle(classId === id)} onClick={() => setClassId(id)}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', color: C.go, marginBottom: '4px' }}>{cls.name}</div>
              <div style={{ fontSize: '11px', color: C.dim, lineHeight: 1.5, marginBottom: '6px' }}>{cls.description}</div>
              <div style={{ fontSize: '10px', color: C.dim, fontStyle: 'italic', marginBottom: '6px' }}>{cls.playstyle}</div>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', color: C.ft }}>
                {d.classStep.hitDie} d{cls.hit_die} · {d.classStep.savingThrows}: {cls.saving_throws.map(a => al[a]).join('/')}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  function SubclassStep() {
    if (!selectedClass?.subclass_at_1) return null
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{selectedClass.subclass_at_1.label}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
          {selectedClass.subclass_at_1.options.map(opt => (
            <div key={opt.id} style={cardStyle(subclassId === opt.id)} onClick={() => setSubclassId(opt.id)}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', color: C.go, marginBottom: '4px' }}>{opt.name}</div>
              <div style={{ fontSize: '11px', color: C.dim, lineHeight: 1.5 }}>{opt.description}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  function BackgroundStep() {
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{d.background.title}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
          {Object.entries(backgroundMap).map(([id, bg]) => (
            <div key={id} style={cardStyle(backgroundId === id)} onClick={() => setBackgroundId(id)}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', color: C.go, marginBottom: '4px' }}>{bg.name}</div>
              <div style={{ fontSize: '11px', color: C.dim, lineHeight: 1.5, marginBottom: '6px' }}>{bg.description}</div>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', color: C.ft, lineHeight: 1.8 }}>
                {d.background.skills}: {bg.skills.join(', ')}<br />
                {d.background.asi}: {d.background.asiNote}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  function SkillsStep() {
    if (!selectedClass || !selectedBackground) return null
    const count = selectedClass.skill_choices.count
    const bgSkills = selectedBackground.skills
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{d.skillsStep.title}</div>
        <div style={{ fontSize: '12px', color: C.dim, marginBottom: '10px' }}>
          {d.skillsStep.chooseN.replace('{n}', String(count)).replace('{cls}', selectedClass.name)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {selectedClass.skill_choices.from.map(skill => {
            const fromBg = bgSkills.includes(skill)
            const checked = fromBg || selectedSkills.includes(skill)
            return (
              <label
                key={skill}
                onClick={() => { if (!fromBg) toggleSkill(skill) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  background: checked ? 'rgba(42,107,58,.2)' : C.cd,
                  border: `1px solid ${checked ? C.gl : C.br}`,
                  padding: '5px 9px', fontSize: '12px',
                  cursor: fromBg ? 'not-allowed' : 'pointer',
                  opacity: fromBg ? 0.7 : 1,
                }}
              >
                <input type="checkbox" checked={checked} disabled={fromBg} readOnly />
                {skill}{fromBg ? ` ✓ ${d.skillsStep.fromBackground}` : ''}
              </label>
            )
          })}
        </div>
      </div>
    )
  }

  function AbilityScoresStep() {
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{d.abilityScores.title}</div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <button onClick={() => setAbilityMethod('standard')} style={{ ...secondaryBtn, ...(abilityMethod === 'standard' ? { borderColor: C.gl, color: C.go } : {}) }}>{d.abilityScores.standardTab}</button>
          <button onClick={() => setAbilityMethod('roll')} style={{ ...secondaryBtn, ...(abilityMethod === 'roll' ? { borderColor: C.gl, color: C.go } : {}) }}>{d.abilityScores.rollTab}</button>
        </div>

        {abilityMethod === 'roll' && (
          <div style={{ marginBottom: '14px' }}>
            {rolledValues.length === 0 ? (
              <button onClick={() => setRolledValues(rollAbilityScoreSet())} style={primaryBtn(false)}>{d.abilityScores.rollButton}</button>
            ) : (
              <div>
                <div style={{ fontSize: '12px', color: C.dim, marginBottom: '8px' }}>{d.abilityScores.rolled}: {rolledValues.join(', ')}</div>
                <button
                  onClick={() => { if (rollsUsed === 0) { setRolledValues(rollAbilityScoreSet()); setRollsUsed(1) } }}
                  disabled={rollsUsed > 0}
                  style={primaryBtn(rollsUsed > 0)}
                >
                  {rollsUsed > 0 ? d.abilityScores.rerollUsed : d.abilityScores.rerollButton}
                </button>
              </div>
            )}
          </div>
        )}

        {(abilityMethod === 'standard' || rolledValues.length > 0) && (
          <>
            <div style={{ fontSize: '12px', color: C.dim, marginBottom: '10px' }}>{d.abilityScores.assignPrompt}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
              {ABILITY_ORDER.map(k => {
                const idx = assignment[k]
                const base = idx !== undefined ? sourceValues[idx] : null
                const bonus = bonusPrimary === k ? 2 : bonusSecondary === k ? 1 : 0
                const final = base !== null ? base + bonus : null
                return (
                  <div key={k} style={{ background: C.cd, border: `1px solid ${C.br}`, padding: '10px', textAlign: 'center' }}>
                    <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: C.ft, marginBottom: '6px' }}>{al[k]}</div>
                    <select
                      value={idx ?? ''}
                      onChange={e => {
                        const v = e.target.value === '' ? undefined : Number(e.target.value)
                        setAssignment(prev => ({ ...prev, [k]: v }))
                      }}
                      style={{ width: '100%', background: C.lt, border: `1px solid ${C.br}`, color: C.ink, padding: '6px', fontSize: '13px', marginBottom: '6px' }}
                    >
                      <option value="">{d.abilityScores.unassigned}</option>
                      {sourceValues.map((v, i) => (
                        <option key={i} value={i} disabled={usedIndices.has(i) && idx !== i}>{v}</option>
                      ))}
                    </select>
                    {final !== null && (
                      <>
                        <div style={{ fontSize: '18px', fontWeight: 600, color: C.ink }}>{final}</div>
                        <div style={{ fontSize: '12px', color: C.go }}>{formatMod(abilityMod(final))}</div>
                        {bonus > 0 && <div style={{ fontSize: '9px', color: C.ft, marginTop: '2px' }}>{d.abilityScores.backgroundBonus}: +{bonus}</div>}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {selectedBackground && (
          <div style={{ marginTop: '18px' }}>
            <div style={sectionLabel}>{d.abilityScores.bonusTitle}</div>
            <div style={{ fontSize: '12px', color: C.dim, marginBottom: '10px' }}>
              {d.abilityScores.bonusDesc.replace('{bg}', selectedBackground.name)}
            </div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: C.ft, marginBottom: '4px' }}>{d.abilityScores.bonusPlusTwo}</div>
                <select
                  value={bonusPrimary}
                  onChange={e => {
                    const v = e.target.value as AbilityId | ''
                    setBonusPrimary(v)
                    setBonusSecondary(prev => prev === v ? '' : prev)
                  }}
                  style={{ background: C.lt, border: `1px solid ${C.br}`, color: C.ink, padding: '6px', fontSize: '13px' }}
                >
                  <option value="">{d.abilityScores.unassigned}</option>
                  {ABILITY_ORDER.map(k => <option key={k} value={k}>{al[k]}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: C.ft, marginBottom: '4px' }}>{d.abilityScores.bonusPlusOne}</div>
                <select
                  value={bonusSecondary}
                  onChange={e => setBonusSecondary(e.target.value as AbilityId | '')}
                  style={{ background: C.lt, border: `1px solid ${C.br}`, color: C.ink, padding: '6px', fontSize: '13px' }}
                >
                  <option value="">{d.abilityScores.unassigned}</option>
                  {ABILITY_ORDER.filter(k => k !== bonusPrimary).map(k => <option key={k} value={k}>{al[k]}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {draftCharacter && (
          <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
            <span style={{ background: C.lt, border: `1px solid ${C.br}`, padding: '6px 12px', fontSize: '12px' }}>{dict.newGame.review.hp} {draftCharacter.hp_max}</span>
            <span style={{ background: C.lt, border: `1px solid ${C.br}`, padding: '6px 12px', fontSize: '12px' }}>{dict.newGame.review.ac} {draftCharacter.ac}</span>
          </div>
        )}
      </div>
    )
  }

  function SpellsStep() {
    if (!selectedClass?.is_caster) return null
    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '16px', color: C.go, marginBottom: '14px' }}>{d.spells.title}</div>

        <div style={sectionLabel}>{d.spells.cantrips} — {d.spells.chooseUpTo.replace('{n}', String(selectedClass.cantrips_known || 0))}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
          {(selectedClass.cantrip_list || []).map(sp => (
            <label key={sp} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: cantrips.includes(sp) ? 'rgba(42,107,58,.2)' : C.cd, border: `1px solid ${cantrips.includes(sp) ? C.gl : C.br}`, padding: '5px 9px', fontSize: '12px', cursor: 'pointer' }}>
              <input type="checkbox" checked={cantrips.includes(sp)} onChange={() => toggleCantrip(sp)} />
              {sp}
            </label>
          ))}
        </div>

        <div style={sectionLabel}>{d.spells.spellsKnown} — {d.spells.chooseUpTo.replace('{n}', String(selectedClass.spells_known_at_1 || 0))}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {(selectedClass.spell_list_at_1 || []).map(sp => (
            <label key={sp} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: spellsKnown.includes(sp) ? 'rgba(42,107,58,.2)' : C.cd, border: `1px solid ${spellsKnown.includes(sp) ? C.gl : C.br}`, padding: '5px 9px', fontSize: '12px', cursor: 'pointer' }}>
              <input type="checkbox" checked={spellsKnown.includes(sp)} onChange={() => toggleSpell(sp)} />
              {sp}
            </label>
          ))}
        </div>
      </div>
    )
  }

  function ReviewStep() {
    const rc = reviewCharacter
    if (!rc) return <div style={{ color: C.dim }}>—</div>
    const r = dict.newGame.review
    const mods: Record<AbilityId, number> = {
      str: abilityMod(rc.str), dex: abilityMod(rc.dex), con: abilityMod(rc.con),
      int: abilityMod(rc.int), wis: abilityMod(rc.wis), cha: abilityMod(rc.cha),
    }
    const speciesName = speciesMap[rc.species]?.name || rc.species
    const subraceName = rc.subrace ? speciesMap[rc.species]?.subraces?.[rc.subrace]?.name : undefined
    const className = classMap[rc.class]?.name || rc.class
    const subclassName = rc.subclass ? classMap[rc.class]?.subclass_at_1?.options.find(o => o.id === rc.subclass)?.name : undefined
    const backgroundName = backgroundMap[rc.background]?.name || rc.background

    return (
      <div>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '18px', color: C.go, marginBottom: '4px' }}>{rc.name}{rc.pronouns ? ` (${rc.pronouns})` : ''}</div>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: C.rl, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '14px' }}>
          {speciesName}{subraceName ? ` (${subraceName})` : ''} · {className}{subclassName ? ` – ${subclassName}` : ''} · {backgroundName} · {r.level} 1
        </div>

        <div style={sectionLabel}>{r.abilityScores}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '6px', marginBottom: '10px' }}>
          {ABILITY_ORDER.map(k => (
            <div key={k} style={{ background: C.cd, border: `1px solid ${C.br}`, padding: '8px', textAlign: 'center' }}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '8px', color: C.ft }}>{al[k]}</div>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>{rc[k]}</div>
              <div style={{ fontSize: '11px', color: C.go }}>{formatMod(mods[k])}</div>
            </div>
          ))}
        </div>

        <div style={sectionLabel}>{r.combatStats}</div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
          <span style={{ background: C.lt, border: `1px solid ${C.br}`, padding: '6px 10px', fontSize: '12px' }}>{r.hp} {rc.hp_max}</span>
          <span style={{ background: C.lt, border: `1px solid ${C.br}`, padding: '6px 10px', fontSize: '12px' }}>{r.ac} {rc.ac}</span>
          <span style={{ background: C.lt, border: `1px solid ${C.br}`, padding: '6px 10px', fontSize: '12px' }}>{r.speed} {rc.speed}ft</span>
          <span style={{ background: C.lt, border: `1px solid ${C.br}`, padding: '6px 10px', fontSize: '12px' }}>{r.initiative} {formatMod(mods.dex)}</span>
          <span style={{ background: C.lt, border: `1px solid ${C.br}`, padding: '6px 10px', fontSize: '12px' }}>{r.proficiencyBonus} +2</span>
        </div>

        <div style={sectionLabel}>{r.savingThrows}</div>
        <div style={{ fontSize: '12px', color: C.dim, marginBottom: '10px' }}>
          {ABILITY_ORDER.map(k => `${al[k]} ${formatMod(mods[k] + (rc.saving_throw_profs.includes(k) ? 2 : 0))}${rc.saving_throw_profs.includes(k) ? '*' : ''}`).join('  ·  ')}
        </div>

        <div style={sectionLabel}>{r.skills}</div>
        <div style={{ fontSize: '12px', color: C.dim, marginBottom: '10px' }}>{rc.skill_profs.join(', ')}</div>

        <div style={sectionLabel}>{r.equipment}</div>
        <ul style={{ paddingLeft: '16px', fontSize: '12px', color: C.dim, lineHeight: 1.7, marginBottom: '10px' }}>
          {rc.equipment.map((item, i) => <li key={i}>{item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}{item.notes ? ` — ${item.notes}` : ''}</li>)}
        </ul>

        <div style={sectionLabel}>{r.features}</div>
        <div style={{ fontSize: '12px', color: C.dim, lineHeight: 1.7, marginBottom: '10px' }}>
          {rc.features.map((f, i) => <div key={i}><strong style={{ color: C.ink }}>{f.name}</strong>: {f.description}</div>)}
        </div>

        {(rc.cantrips?.length || rc.spells_known?.length) ? (
          <>
            <div style={sectionLabel}>{r.spells}</div>
            {rc.cantrips?.length ? <div style={{ fontSize: '12px', color: C.dim, marginBottom: '4px' }}>{dict.newGame.spells.cantrips}: {rc.cantrips.join(', ')}</div> : null}
            {rc.spells_known?.length ? <div style={{ fontSize: '12px', color: C.dim }}>{dict.newGame.spells.spellsKnown}: {rc.spells_known.join(', ')}</div> : null}
          </>
        ) : null}

        {submitError && <div style={{ color: C.rl, fontSize: '12px', marginTop: '10px' }}>{submitError}</div>}

        <button onClick={handleSubmit} disabled={submitting} style={{ ...primaryBtn(submitting), width: '100%', marginTop: '18px', padding: '16px', fontSize: '13px' }}>
          {submitting ? dict.common.loading : r.beginAdventure}
        </button>
      </div>
    )
  }

  function renderDraftSummary() {
    if (path !== 'custom' || !['name', 'species', 'class', 'subclass', 'background', 'skills', 'ability_scores', 'spells'].includes(step)) return null
    return (
      <div style={{ background: C.mid, border: `1px solid ${C.br}`, padding: '14px', minWidth: '220px', flex: '0 0 240px', alignSelf: 'flex-start' }}>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', letterSpacing: '2px', color: C.ft, textTransform: 'uppercase', marginBottom: '10px' }}>{d.review.title}</div>
        <div style={{ fontSize: '13px', color: name ? C.ink : C.br, marginBottom: '4px' }}>{name || '—'}</div>
        <div style={{ fontSize: '11px', color: C.dim, lineHeight: 1.8 }}>
          {selectedSpecies ? `${selectedSpecies.name}${subraceId && selectedSpecies.subraces ? ` (${selectedSpecies.subraces[subraceId]?.name})` : ''}` : '—'}<br />
          {selectedClass ? `${selectedClass.name}${subclassId && selectedClass.subclass_at_1 ? ` – ${selectedClass.subclass_at_1.options.find(o => o.id === subclassId)?.name}` : ''}` : '—'}<br />
          {selectedBackground ? selectedBackground.name : '—'}
        </div>
        {draftCharacter && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            <span style={{ background: C.lt, border: `1px solid ${C.br}`, padding: '4px 8px', fontSize: '11px' }}>{d.review.hp} {draftCharacter.hp_max}</span>
            <span style={{ background: C.lt, border: `1px solid ${C.br}`, padding: '4px 8px', fontSize: '11px' }}>{d.review.ac} {draftCharacter.ac}</span>
          </div>
        )}
      </div>
    )
  }

  function renderStepContent() {
    switch (step) {
      case 'game_select': return GameSelectStep()
      case 'campaign_select': return CampaignSelectStep()
      case 'character_method': return CharacterMethodStep()
      case 'pregen_select': return PregenSelectStep()
      case 'pregen_customize': return PregenCustomizeStep()
      case 'name': return NameStep()
      case 'species': return SpeciesStep()
      case 'class': return ClassStep()
      case 'subclass': return SubclassStep()
      case 'background': return BackgroundStep()
      case 'skills': return SkillsStep()
      case 'ability_scores': return AbilityScoresStep()
      case 'spells': return SpellsStep()
      case 'review': return ReviewStep()
      default: return null
    }
  }

  const isReview = step === 'review'

  // The global stylesheet sets html/body to overflow: hidden for the app-shell
  // screens (e.g. /play). This wizard is a normal scrolling page, so it opts
  // out for as long as it's mounted and restores the previous values on exit.
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prev = { htmlOverflow: html.style.overflow, bodyOverflow: body.style.overflow, htmlHeight: html.style.height, bodyHeight: body.style.height }
    html.style.overflow = 'auto'
    body.style.overflow = 'auto'
    html.style.height = 'auto'
    body.style.height = 'auto'
    return () => {
      html.style.overflow = prev.htmlOverflow
      body.style.overflow = prev.bodyOverflow
      html.style.height = prev.htmlHeight
      body.style.height = prev.bodyHeight
    }
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, fontFamily: "'Crimson Pro', serif" }}>
      <div style={{ background: C.cd, borderBottom: `2px solid ${C.go}`, padding: '12px 16px' }}>
        <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '15px', color: C.go }}>{d.title}</div>
        <div style={{ display: 'flex', gap: '4px', marginTop: '8px', overflowX: 'auto' }}>
          {stepList.map(s => (
            <span key={s} style={{
              fontFamily: "'Cinzel', serif", fontSize: '8px', letterSpacing: '1px', textTransform: 'uppercase',
              padding: '4px 8px', whiteSpace: 'nowrap',
              color: s === step ? C.go : C.ft,
              borderBottom: `2px solid ${s === step ? C.go : 'transparent'}`,
            }}>
              {d.steps[s]}
            </span>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '20px 16px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 480px', minWidth: 0 }}>
          {renderStepContent()}
        </div>
        {renderDraftSummary()}
      </div>

      {!isReview && (
        <div style={{ position: 'sticky', bottom: 0, background: C.cd, borderTop: `1px solid ${C.br}`, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
          <button onClick={goBack} style={secondaryBtn}>{d.back}</button>
          <button onClick={goNext} disabled={!isStepValid()} style={primaryBtn(!isStepValid())}>{d.next}</button>
        </div>
      )}
    </div>
  )
}
