import argparse
import json
import subprocess
from pathlib import Path

import brotli
import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'public/assets/art'
FONT_SOURCE = 'Fonts/SourceHanSansCN-Regular.otf'
FONT_OUTPUT = 'Fonts/OverdriveScene-Regular.woff2'
TEXTURES = [
    ('Textures/Asphalt02/asphalt_02_diff_2k.jpg', 'asphalt_02', 'Diffuse', ['-q', '90', '-m', '6', '-sharp_yuv']),
    ('Textures/Asphalt02/asphalt_02_nor_gl_2k.png', 'asphalt_02', 'OpenGL normal', ['-near_lossless', '60', '-m', '6']),
    ('Textures/Asphalt02/asphalt_02_rough_2k.jpg', 'asphalt_02', 'Roughness', ['-q', '95', '-m', '6', '-sharp_yuv']),
    ('Textures/ConcreteWall006/concrete_wall_006_diff_2k.jpg', 'concrete_wall_006', 'Diffuse', ['-q', '90', '-m', '6', '-sharp_yuv']),
    ('Textures/ConcreteWall006/concrete_wall_006_nor_gl_2k.png', 'concrete_wall_006', 'OpenGL normal', ['-near_lossless', '60', '-m', '6']),
    ('Textures/ConcreteWall006/concrete_wall_006_rough_2k.jpg', 'concrete_wall_006', 'Roughness', ['-q', '95', '-m', '6', '-sharp_yuv']),
]


def prepare_textures():
    records = []
    for source, asset, usage, options in TEXTURES:
        output = str(Path(source).with_suffix('.webp'))
        subprocess.run(['cwebp', *options, str(ART / source), '-o', str(ART / output)], check=True)
        records.append({
            'path': output,
            'asset': asset,
            'usage': usage,
            'derivedFrom': source,
            'bytes': (ART / output).stat().st_size,
            'dimensions': [2048, 2048],
            'processing': 'cwebp ' + ' '.join(options),
        })
    return records


def prepare_font():
    characters = set(chr(codepoint) for codepoint in range(0x20, 0x7f))
    characters.update(chr(codepoint) for codepoint in range(0x3000, 0x3040))
    characters.update(chr(codepoint) for codepoint in range(0xff00, 0xfff0))
    characters.update('↑')
    for path in sorted((ROOT / 'src').rglob('*')):
        if path.suffix in {'.ts', '.css'}:
            characters.update(path.read_text(encoding='utf-8'))
    characters.update((ROOT / 'public/data/beijing-roads.json').read_text(encoding='utf-8'))
    unicodes = {ord(character) for character in characters if character.isprintable() or character == '\u3000'}
    font = TTFont(ART / FONT_SOURCE, recalcTimestamp=False)
    original_cmap = set(font.getBestCmap())
    options = subset.Options()
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    options.layout_features = ['*']
    options.notdef_outline = True
    options.recommended_glyphs = True
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    names = {
        1: 'Overdrive Scene', 2: 'Regular', 3: 'OverdriveScene-Regular-1.000',
        4: 'Overdrive Scene Regular', 6: 'OverdriveScene-Regular',
        16: 'Overdrive Scene', 17: 'Regular', 18: 'Overdrive Scene Regular',
        21: 'Overdrive Scene', 22: 'Regular', 25: 'OverdriveScene-Regular',
    }
    for record in list(font['name'].names):
        if record.nameID in names:
            font['name'].setName(names[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
    cff = font['CFF '].cff
    cff.fontNames = ['OverdriveScene-Regular']
    top = cff.topDictIndex[0]
    top.FullName = 'Overdrive Scene Regular'
    top.FamilyName = 'Overdrive Scene'
    for index, font_dict in enumerate(top.FDArray):
        if hasattr(font_dict, 'FontName'):
            font_dict.FontName = f'OverdriveScene-Regular-FD{index}'
    font.flavor = 'woff2'
    font.save(ART / FONT_OUTPUT)
    result = TTFont(ART / FONT_OUTPUT)
    mapped = set(result.getBestCmap())
    missing = (unicodes & original_cmap) - mapped
    if missing:
        raise RuntimeError(f'字体子集遗漏源字体支持的字符：{sorted(missing)}')
    record = {
        'path': FONT_OUTPUT,
        'asset': 'source_han_sans',
        'usage': 'Scene font subset',
        'derivedFrom': FONT_SOURCE,
        'bytes': (ART / FONT_OUTPUT).stat().st_size,
        'family': 'Overdrive Scene',
        'postscriptName': 'OverdriveScene-Regular',
        'mappedCodepoints': len(mapped),
        'glyphs': len(result.getGlyphOrder()),
        'characterSources': ['src/**/*.ts', 'src/**/*.css', 'public/data/beijing-roads.json', 'U+0020-007E', 'U+3000-303F', 'U+FF00-FFEF', 'U+2191'],
        'processing': f'fontTools {fontTools.__version__} subset + Brotli {brotli.__version__} WOFF2；字体名称改为 Overdrive，保留原始版权与 OFL',
    }
    print(json.dumps({'字体子集': record, '遗漏源字体支持字符': len(missing)}, ensure_ascii=False))
    return record


def main():
    parser = argparse.ArgumentParser(description='从保留的源文件生成启动用 WebP 贴图与中文字体子集')
    parser.add_argument('--font-only', action='store_true', help='场景文字变化时只重新生成字体')
    args = parser.parse_args()
    records = [] if args.font_only else prepare_textures()
    records.append(prepare_font())
    source_path = ART / 'SOURCES.json'
    sources = json.loads(source_path.read_text(encoding='utf-8'))
    changed_paths = {record['path'] for record in records}
    sources['files'] = [record for record in sources['files'] if record['path'] not in changed_paths] + records
    sources['startupAssetOptimization']['fontTools'] = fontTools.__version__
    sources['startupAssetOptimization']['brotli'] = brotli.__version__
    sources['startupAssetOptimization']['sourceTextureAndFontBytes'] = sum((ART / source).stat().st_size for source, *_ in TEXTURES) + (ART / FONT_SOURCE).stat().st_size
    sources['startupAssetOptimization']['runtimeTextureAndFontBytes'] = sum((ART / Path(source).with_suffix('.webp')).stat().st_size for source, *_ in TEXTURES) + (ART / FONT_OUTPUT).stat().st_size
    source_path.write_text(json.dumps(sources, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
