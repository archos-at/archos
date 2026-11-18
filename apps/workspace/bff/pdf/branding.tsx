import React from 'react'
import { Path, StyleSheet, Svg, View } from '@react-pdf/renderer'

import { Text } from './printable-text'
import { wordmarkFontStyle } from './fonts'
import { BRAND_MARK, PRODUCT_NAME } from '@/lib/brand'
import { PDF_PAGE, PDF_THEME, PDF_TYPE } from './theme'

export interface CoverFact {
  label: string
  value: string
  mono?: boolean
}

export interface DocumentChrome {
  headerLine: string
  prose: string
  disclaimer: string
  footerLine: string
  aiDisclosure?: string
}

export interface CoverInfo {
  title: string
  facts: CoverFact[]
  chrome?: DocumentChrome
  notice?: { title: string; body: string }
}

const styles = StyleSheet.create({
  lockup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wordmark: {
    letterSpacing: -0.2,
  },

  coverPage: {
    padding: 0,
    fontFamily: 'Helvetica',
    backgroundColor: PDF_THEME.paper,
  },
  band: {
    backgroundColor: PDF_THEME.ink,
    paddingHorizontal: PDF_PAGE.margin,
    paddingTop: 64,
    paddingBottom: 52,
    height: 320,
    justifyContent: 'space-between',
  },
  coverTitle: {
    color: PDF_THEME.inverse,
    fontWeight: 'bold',
    lineHeight: PDF_TYPE.lineHeightTight,
    letterSpacing: -0.6,
  },
  coverBody: {
    paddingHorizontal: PDF_PAGE.margin,
    paddingTop: 44,
    flexGrow: 1,
  },
  coverNotice: {
    borderLeftWidth: 3,
    borderLeftColor: PDF_THEME.ink,
    paddingLeft: 10,
    paddingVertical: 2,
    marginBottom: 28,
  },
  coverNoticeTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  coverNoticeBody: {
    fontSize: 9,
    color: PDF_THEME.subtle,
    lineHeight: 1.45,
  },
  factRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: PDF_THEME.hairline,
    paddingVertical: 9,
  },
  factLabel: {
    width: '32%',
    fontSize: PDF_TYPE.meta,
    color: PDF_THEME.subtle,
  },
  factValue: {
    flexGrow: 1,
    fontSize: PDF_TYPE.body,
    color: PDF_THEME.ink,
  },
  factValueMono: {
    fontFamily: 'Courier',
    fontSize: PDF_TYPE.body - 1,
  },
  coverHeaderLine: {
    fontSize: PDF_TYPE.chrome,
    color: PDF_THEME.subtle,
    marginBottom: 22,
  },
  coverDisclosure: {
    fontSize: PDF_TYPE.chrome,
    color: PDF_THEME.ink,
    marginTop: -14,
    marginBottom: 22,
  },
  coverProse: {
    marginTop: 26,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: PDF_THEME.hairline,
  },
  coverProseText: {
    fontSize: PDF_TYPE.meta,
    color: PDF_THEME.subtle,
    lineHeight: 1.45,
  },
  coverDisclaimer: {
    fontSize: PDF_TYPE.meta,
    color: PDF_THEME.subtle,
    lineHeight: 1.45,
    marginTop: 6,
  },
  coverFooter: {
    position: 'absolute',
    left: PDF_PAGE.margin,
    right: PDF_PAGE.margin,
    bottom: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  coverRule: {
    flexGrow: 1,
    height: 2,
    marginLeft: 14,
    backgroundColor: PDF_THEME.accent,
  },

  header: {
    position: 'absolute',
    top: PDF_PAGE.headerTop,
    left: PDF_PAGE.margin,
    right: PDF_PAGE.margin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: PDF_THEME.hairline,
    paddingBottom: 8,
  },
  headerTitle: {
    fontFamily: 'Helvetica',
    fontSize: PDF_TYPE.chrome,
    color: PDF_THEME.subtle,
    maxWidth: '62%',
    textAlign: 'right',
  },

  footer: {
    position: 'absolute',
    bottom: PDF_PAGE.footerBottom,
    left: PDF_PAGE.margin,
    right: PDF_PAGE.margin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: PDF_THEME.hairline,
    paddingTop: 8,
  },
  footerText: {
    fontFamily: 'Helvetica',
    fontSize: PDF_TYPE.chrome,
    color: PDF_THEME.subtle,
  },
  pageNumber: {
    fontFamily: 'Helvetica',
    fontSize: PDF_TYPE.chrome,
    color: PDF_THEME.subtle,
    fontWeight: 'bold',
  },
})

export const BrandMark: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <Svg width={size * BRAND_MARK.aspect} height={size} viewBox={BRAND_MARK.viewBox}>
    <Path d={BRAND_MARK.path} fill={color} />
  </Svg>
)

export const BrandLockup: React.FC<{
  size: number
  color: string
  fontSize?: number
}> = ({ size, color, fontSize }) => (
  <View style={styles.lockup}>
    <Text style={[styles.wordmark, wordmarkFontStyle(), { fontSize: fontSize ?? size, color }]}>
      {PRODUCT_NAME.toUpperCase()}
    </Text>
  </View>
)

export const RunningHeader: React.FC<{ title: string }> = ({ title }) => (
  <View style={styles.header} fixed>
    <BrandLockup size={9} color={PDF_THEME.ink} />
    <Text style={styles.headerTitle}>{title}</Text>
  </View>
)

export const PageFooter: React.FC<{ line?: string }> = ({ line }) => (
  <View style={styles.footer} fixed>
    <BrandLockup size={8} color={PDF_THEME.subtle} />
    {/* Between the wordmark and the numeral, because that is where a reader's eye
        is not: the two ends of a footer are the two things they look for, and
        „Entwurf, nicht freigegeben" is the thing they should meet on the way. */}
    {line ? <Text style={styles.footerText}>{line}</Text> : null}
    <Text
      style={styles.pageNumber}
      render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
    />
  </View>
)

const coverTitleSize = (title: string): number =>
  title.length > PDF_TYPE.coverTitleBreak ? PDF_TYPE.coverTitleLong : PDF_TYPE.coverTitle

export const CoverContent: React.FC<{ cover: CoverInfo }> = ({ cover }) => (
  <>
    <View style={styles.band}>
      <BrandLockup size={26} color={PDF_THEME.inverse} fontSize={22} />
      <Text style={[styles.coverTitle, { fontSize: coverTitleSize(cover.title) }]}>
        {cover.title}
      </Text>
    </View>

    <View style={styles.coverBody}>
      {cover.chrome ? <Text style={styles.coverHeaderLine}>{cover.chrome.headerLine}</Text> : null}
      {cover.chrome?.aiDisclosure ? (
        <Text style={styles.coverDisclosure}>{cover.chrome.aiDisclosure}</Text>
      ) : null}
      {cover.notice ? (
        <View style={styles.coverNotice} wrap={false}>
          <Text style={styles.coverNoticeTitle}>{cover.notice.title}</Text>
          <Text style={styles.coverNoticeBody}>{cover.notice.body}</Text>
        </View>
      ) : null}
      {cover.facts.map((fact, index) => (
        <View key={index} style={styles.factRow}>
          <Text style={styles.factLabel}>{fact.label}</Text>
          <Text style={[styles.factValue, ...(fact.mono ? [styles.factValueMono] : [])]}>
            {fact.value}
          </Text>
        </View>
      ))}
      {cover.chrome ? (
        <View style={styles.coverProse} wrap={false}>
          <Text style={styles.coverProseText}>{cover.chrome.prose}</Text>
          <Text style={styles.coverDisclaimer}>{cover.chrome.disclaimer}</Text>
        </View>
      ) : null}
    </View>

    {/* The icon's glyph at the foot of the cover, with the accent rule
        running out of it — the one loud gesture on an otherwise quiet page. */}
    <View style={styles.coverFooter}>
      <BrandMark size={12} color={PDF_THEME.ink} />
      <View style={styles.coverRule} />
    </View>
  </>
)

export const COVER_PAGE_STYLE = styles.coverPage
