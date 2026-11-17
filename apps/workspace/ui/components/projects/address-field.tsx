'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Listbox, ListboxOption } from '@/components/ui/listbox'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { createGeocodingClient, type GeocodingClient } from '@/lib/geocoding/client'
import { GEOCODE_DEFAULT_LIMIT, type GeocodeResult } from '@/lib/geocoding/types'
import { MAX_ADDRESS_LENGTH } from '@/lib/projects/create-project-schema'
import { createSameAddressClient, type SameAddressClient } from '@/lib/projects/same-address-client'
import { SameAddressNotice } from './same-address-notice'

export const ADDRESS_SEARCH_DEBOUNCE_MS = 250
const MIN_QUERY_LENGTH = 3

let geocoderKnownOff = false

export function forgetGeocoderAnswer(): void {
  geocoderKnownOff = false
}

type SearchStatus = 'idle' | 'waiting' | 'searching' | 'done'

export function placeLine(place: Pick<GeocodeResult, 'municipality' | 'state'>): string {
  return [place.municipality, place.state].filter(Boolean).join(' · ')
}

export interface AddressValue {
  text: string
  place: GeocodeResult | null
}

export interface AddressFieldProps {
  value: AddressValue
  onChange: (value: AddressValue) => void
  disabled?: boolean
  client?: GeocodingClient
  sameAddressClient?: SameAddressClient
}

export function AddressField({
  value,
  onChange,
  disabled = false,
  client,
  sameAddressClient,
}: AddressFieldProps): JSX.Element {
  const t = useTranslations(projectsCopy)
  const id = useId()
  const listId = `${id}-list`
  const geocoder = useRef<GeocodingClient>(client ?? createGeocodingClient())
  const sameAddress = useRef<SameAddressClient>(sameAddressClient ?? createSameAddressClient())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  const [searchOff, setSearchOff] = useState(geocoderKnownOff)
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    inFlight.current?.abort()
    inFlight.current = null
  }, [])
  useEffect(() => cancel, [cancel])

  const search = useCallback(async (query: string) => {
    const controller = new AbortController()
    inFlight.current = controller
    setStatus('searching')
    try {
      const answer = await geocoder.current.search(query, GEOCODE_DEFAULT_LIMIT, { signal: controller.signal })
      if (controller.signal.aborted) return
      if (!answer.enabled) {
        geocoderKnownOff = true
        setSearchOff(true)
        setResults([])
        setStatus('idle')
        return
      }
      setResults(answer.results)
      setActive(answer.results.length > 0 ? 0 : -1)
      setStatus('done')
    } catch {
      if (controller.signal.aborted) return
      setResults([])
      setStatus('done')
    }
  }, [])

  const onInput = (next: string): void => {
    cancel()
    onChange({ text: next, place: null })
    setActive(-1)
    if (searchOff || next.trim().length < MIN_QUERY_LENGTH) {
      setResults([])
      setStatus('idle')
      return
    }
    setOpen(true)
    setStatus('waiting')
    timer.current = setTimeout(() => void search(next.trim()), ADDRESS_SEARCH_DEBOUNCE_MS)
  }

  const choose = (place: GeocodeResult): void => {
    cancel()
    onChange({ text: place.label, place })
    setResults([])
    setStatus('idle')
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape' && open && results.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => (index + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => (index <= 0 ? results.length - 1 : index - 1))
    } else if (event.key === 'Enter' && open && active >= 0) {
      event.preventDefault()
      choose(results[active])
    }
  }

  const listed = open && results.length > 0
  const searching = status === 'waiting' || status === 'searching'
  const chosen = value.place

  return (
    <Field>
      <FieldLabel htmlFor={`${id}-input`}>{t('form.addressLabel')}</FieldLabel>
      <div className="relative">
        <Input
          id={`${id}-input`}
          role={searchOff ? undefined : 'combobox'}
          aria-label={t('form.addressLabel')}
          aria-expanded={searchOff ? undefined : listed}
          aria-controls={searchOff ? undefined : listId}
          aria-autocomplete={searchOff ? undefined : 'list'}
          aria-activedescendant={listed && active >= 0 ? `${id}-option-${active}` : undefined}
          autoComplete="street-address"
          value={value.text}
          maxLength={MAX_ADDRESS_LENGTH}
          placeholder={t('form.addressPlaceholder')}
          disabled={disabled}
          onChange={(event) => onInput(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          data-testid="create-project-address"
        />
        {searching && (
          <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2" aria-label={t('form.address.searching')} />
        )}
        {listed && (
          <div
            className="bg-popover text-popover-foreground absolute inset-x-0 top-full z-20 mt-1.5 rounded-overlay p-1 shadow-lg"
            data-testid="create-project-address-suggestions"
          >
            <Listbox
              id={listId}
              aria-label={t('form.address.suggestions')}
              className="rounded-none border-0 p-0 shadow-none"
            >
              {results.map((place, index) => (
                <ListboxOption
                  key={`${place.label}-${place.lat}-${place.lon}`}
                  id={`${id}-option-${index}`}
                  active={index === active}
                  onChoose={() => choose(place)}
                  className="flex-row items-center justify-start gap-2.5 py-2"
                >
                  <MapPin className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{place.label}</span>
                    {placeLine(place) && (
                      <span className="text-muted-foreground truncate text-xs">{placeLine(place)}</span>
                    )}
                  </span>
                </ListboxOption>
              ))}
            </Listbox>
            <p className="text-muted-foreground border-border mt-1 border-t px-2.5 pt-2 pb-1.5 text-xs">
              {t('form.address.keepTyped')}
            </p>
            {/* The hits are OpenStreetMap data, whose licence (ODbL) asks for this line. */}
            <p className="text-muted-foreground px-2.5 pb-1 text-xs" data-testid="create-project-address-attribution">
              {t('form.address.attribution')}
            </p>
          </div>
        )}
      </div>
      {chosen && placeLine(chosen) && (
        <FieldDescription className="flex items-center gap-1.5" data-testid="create-project-address-place">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          {placeLine(chosen)}
        </FieldDescription>
      )}
      {chosen && <SameAddressNotice place={chosen} client={sameAddress.current} />}
    </Field>
  )
}
