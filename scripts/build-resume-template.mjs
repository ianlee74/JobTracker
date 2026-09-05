// Builds skills/templates/resume.docx — the app-wide formatting template for
// generated resumes and cover letters. The package is written from scratch so
// it carries no personal content or metadata: named paragraph/character
// styles that define the look (Calibri, navy 1F3864 headings, grey 555555
// details), one bullet list definition, page setup, and a placeholder
// skeleton in document.xml showing which style each part of a resume uses.
// Re-run `node scripts/build-resume-template.mjs` after changing anything here.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'templates', 'resume.docx');
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const NAVY = '1F3864', GREY = '555555', INK = '333333';
const RIGHT_TAB = '<w:tabs><w:tab w:val="right" w:pos="10620"/></w:tabs>';

// Paragraph styles: id, display name, optional basedOn/next, paragraph
// properties, and the run properties every run in the paragraph inherits.
// Sizes are half-points.
function pStyle({ id, name, basedOn, next, pPr = '', rPr = '' }) {
  return `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/>` +
    (basedOn ? `<w:basedOn w:val="${basedOn}"/>` : '') +
    `<w:next w:val="${next ?? id}"/><w:qFormat/>` +
    (pPr ? `<w:pPr>${pPr}</w:pPr>` : '') +
    (rPr ? `<w:rPr>${rPr}</w:rPr>` : '') +
    '</w:style>';
}
function cStyle({ id, name, rPr }) {
  return `<w:style w:type="character" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:qFormat/><w:rPr>${rPr}</w:rPr></w:style>`;
}
const run = ({ b, i, color, sz }) =>
  (b === true ? '<w:b/><w:bCs/>' : b === false ? '<w:b w:val="0"/><w:bCs w:val="0"/>' : '') +
  (i === true ? '<w:i/><w:iCs/>' : i === false ? '<w:i w:val="0"/><w:iCs w:val="0"/>' : '') +
  (color ? `<w:color w:val="${color}"/>` : '') +
  (sz ? `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` : '');

const stylesXml = XML_DECL + `<w:styles xmlns:w="${W_NS}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>' +
  '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:semiHidden/></w:style>' +
  // --- Header block ---
  pStyle({ id: 'Name', name: 'Resume Name', next: 'Headline', pPr: '<w:spacing w:after="20"/>', rPr: run({ b: true, color: NAVY, sz: 40 }) }) +
  pStyle({ id: 'Headline', name: 'Resume Headline', next: 'Contact', pPr: '<w:spacing w:after="80"/>', rPr: run({ b: true, color: GREY, sz: 24 }) }) +
  pStyle({ id: 'Contact', name: 'Resume Contact', next: 'Body', pPr: '<w:spacing w:after="160"/>', rPr: run({ color: GREY, sz: 22 }) }) +
  // --- Sections ---
  pStyle({ id: 'SectionHeading', name: 'Resume Section Heading', next: 'Body',
    pPr: `<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${NAVY}"/></w:pBdr><w:spacing w:before="200" w:after="80"/>`,
    rPr: run({ b: true, color: NAVY, sz: 24 }) }) +
  pStyle({ id: 'Body', name: 'Resume Body', pPr: '<w:spacing w:after="100"/>', rPr: run({ color: INK, sz: 21 }) }) +
  pStyle({ id: 'SkillLine', name: 'Resume Skill Line', pPr: '<w:spacing w:after="60"/>', rPr: run({ color: INK, sz: 21 }) }) +
  // --- Experience ---
  pStyle({ id: 'RoleHeader', name: 'Resume Role Header', next: 'RoleTitle',
    pPr: `<w:keepNext/>${RIGHT_TAB}<w:spacing w:before="140" w:after="20"/>`, rPr: run({ b: true, color: NAVY, sz: 23 }) }) +
  pStyle({ id: 'RoleTitle', name: 'Resume Role Title', next: 'Technologies',
    pPr: `<w:keepNext/>${RIGHT_TAB}<w:spacing w:after="60"/>`, rPr: run({ b: true, i: true, color: INK, sz: 21 }) }) +
  pStyle({ id: 'Technologies', name: 'Resume Technologies', next: 'Bullet',
    pPr: '<w:keepNext/><w:spacing w:after="80"/>', rPr: run({ i: true, color: GREY, sz: 22 }) }) +
  pStyle({ id: 'Bullet', name: 'Resume Bullet',
    pPr: '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="40"/><w:ind w:left="360" w:hanging="260"/><w:contextualSpacing/>',
    rPr: run({ color: INK, sz: 21 }) }) +
  pStyle({ id: 'EarlierRole', name: 'Resume Earlier Role', next: 'EarlierDetail',
    pPr: `<w:keepNext/>${RIGHT_TAB}<w:spacing w:after="30"/>`, rPr: run({ b: true, color: NAVY, sz: 21 }) }) +
  pStyle({ id: 'EarlierDetail', name: 'Resume Earlier Detail', next: 'EarlierRole',
    pPr: '<w:spacing w:after="70"/><w:ind w:left="200"/>', rPr: run({ color: INK, sz: 20 }) }) +
  pStyle({ id: 'Entry', name: 'Resume Entry', pPr: '<w:spacing w:after="40"/>', rPr: run({ color: INK, sz: 21 }) }) +
  // --- Cover letter ---
  pStyle({ id: 'LetterBody', name: 'Letter Body', pPr: '<w:spacing w:after="160"/>', rPr: run({ color: INK, sz: 22 }) }) +
  // --- Character styles for mixed runs inside one paragraph ---
  cStyle({ id: 'Label', name: 'Resume Label', rPr: run({ b: true, i: false }) }) +
  cStyle({ id: 'Muted', name: 'Resume Muted', rPr: run({ b: false, i: false, color: GREY, sz: 21 }) }) +
  cStyle({ id: 'Dates', name: 'Resume Dates', rPr: run({ b: false, i: true, color: GREY, sz: 21 }) }) +
  cStyle({ id: 'Subtitle', name: 'Resume Subtitle', rPr: run({ b: false, i: true, color: INK, sz: 21 }) }) +
  '</w:styles>';

const numberingXml = XML_DECL + `<w:numbering xmlns:w="${W_NS}">` +
  '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="260"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:hint="default"/></w:rPr></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="◦"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="260"/></w:pPr></w:lvl>' +
  '</w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '</w:numbering>';

const settingsXml = XML_DECL + `<w:settings xmlns:w="${W_NS}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

// --- The placeholder skeleton -------------------------------------------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const t = (text) => `<w:t${/^\s|\s$/.test(text) ? ' xml:space="preserve"' : ''}>${esc(text)}</w:t>`;
const r = (text, style) => `<w:r>${style ? `<w:rPr><w:rStyle w:val="${style}"/></w:rPr>` : ''}${t(text)}</w:r>`;
const tabRun = (text, style) => `<w:r><w:rPr><w:rStyle w:val="${style}"/></w:rPr><w:tab/>${t(text)}</w:r>`;
const p = (style, ...runs) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runs.join('')}</w:p>`;

const body = [
  p('Name', r('FULL NAME')),
  p('Headline', r('Headline: Target Title | Secondary Title')),
  p('Contact', r('City, ST  •  (000) 000-0000  •  email@example.com  •  linkedin.com/in/handle')),

  p('SectionHeading', r('PROFESSIONAL SUMMARY')),
  p('Body', r('Two to four lines summarizing the candidate for this specific role.')),

  p('SectionHeading', r('CORE SKILLS')),
  p('SkillLine', r('Skill Group: ', 'Label'), r('Skill, Skill, Skill, Skill')),
  p('SkillLine', r('Skill Group: ', 'Label'), r('Skill, Skill, Skill, Skill')),

  p('SectionHeading', r('PROFESSIONAL EXPERIENCE')),
  p('RoleHeader', r('Company Name'), tabRun('City, ST', 'Muted')),
  p('RoleTitle', r('Job Title'), tabRun('MM/YYYY – MM/YYYY', 'Dates')),
  p('Technologies', r('Technologies: ', 'Label'), r('Tool, Tool, Tool')),
  p('Bullet', r('Accomplishment bullet with a concrete outcome.')),
  p('Bullet', r('Accomplishment bullet with a concrete outcome.')),

  p('SectionHeading', r('EARLIER CAREER')),
  p('EarlierRole', r('Company Name'), r(' — Job Title', 'Subtitle'), tabRun('MM/YYYY – MM/YYYY', 'Dates')),
  p('EarlierDetail', r('One line on the role; key technologies.')),

  p('SectionHeading', r('EDUCATION & CERTIFICATIONS')),
  p('Entry', r('Degree, Field — Institution (YYYY – YYYY)')),
  p('Entry', r('Certification (YYYY)')),

  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="810" w:bottom="720" w:left="810" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>'
].join('\n');

const documentXml = XML_DECL + `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">\n<w:body>\n${body}\n</w:body>\n</w:document>\n`;

const contentTypes = XML_DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
  '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
  '</Types>';

const rootRels = XML_DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  `<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>` +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  `<Relationship Id="rId3" Type="${R_NS}/extended-properties" Target="docProps/app.xml"/>` +
  '</Relationships>';

const docRels = XML_DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  `<Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>` +
  `<Relationship Id="rId2" Type="${R_NS}/numbering" Target="numbering.xml"/>` +
  `<Relationship Id="rId3" Type="${R_NS}/settings" Target="settings.xml"/>` +
  '</Relationships>';

const coreXml = XML_DECL + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  '<dc:title>Resume</dc:title><dc:creator>JobTracker</dc:creator>' +
  '<dcterms:created xsi:type="dcterms:W3CDTF">2026-09-05T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-05T00:00:00Z</dcterms:modified>' +
  '</cp:coreProperties>';
const appXml = XML_DECL + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>JobTracker</Application></Properties>';

const zip = new JSZip();
zip.file('[Content_Types].xml', contentTypes);
zip.file('_rels/.rels', rootRels);
zip.file('word/document.xml', documentXml);
zip.file('word/_rels/document.xml.rels', docRels);
zip.file('word/styles.xml', stylesXml);
zip.file('word/numbering.xml', numberingXml);
zip.file('word/settings.xml', settingsXml);
zip.file('docProps/core.xml', coreXml);
zip.file('docProps/app.xml', appXml);
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`wrote ${OUT}`);
