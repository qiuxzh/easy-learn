/** SVG 原始尺寸。 */
export type SvgDimensions = {
  width: number;
  height: number;
};

/** SVG 转图片所需的数据。 */
type SvgImageSource = {
  dataUrl: string;
  width?: number;
  height?: number;
};

const IMAGE_SCALE = 2;
const MAX_CANVAS_SIZE = 4096;

/**
 * 校验 SVG 代码块，返回错误信息，合法时返回 undefined。
 *
 * 这里按 XML 严格校验：用户手写的 SVG 应当本身合法。渲染路径则改用 HTML 解析，
 * 以兼容 mermaid 这类由 HTML 序列化产出的 SVG 字符串。
 */
export function validateSvgSource(source: string): string | undefined {
  const parsedDocument = new DOMParser().parseFromString(source, 'image/svg+xml');

  if (parsedDocument.querySelector('parsererror')) {
    return 'SVG 语法错误';
  }

  const root = parsedDocument.documentElement;

  if (root.localName.toLowerCase() !== 'svg') {
    return '代码块内容不是有效的 SVG';
  }

  const forbiddenElement = parsedDocument.querySelector('script, foreignObject');
  if (forbiddenElement) {
    return `SVG 包含不允许的标签：${forbiddenElement.tagName}`;
  }

  for (const element of parsedDocument.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();

      if (attributeName.startsWith('on')) {
        return `SVG 包含不允许的事件属性：${attribute.name}`;
      }

      if (attributeName === 'href' || attributeName === 'xlink:href') {
        const href = attribute.value.trim().toLowerCase();

        if (href && !href.startsWith('#') && !href.startsWith('data:')) {
          return 'SVG 包含不允许的外部引用';
        }
      }
    }
  }

  return undefined;
}

/**
 * 解析 SVG 字符串并取出根 svg 元素，取不到时返回 undefined。
 *
 * 用 HTML 解析而不是 image/svg+xml：mermaid 返回的 SVG 由 innerHTML（HTML 序列化）
 * 产出，含未闭合的 <br>、&nbsp; 实体等非法 XML 写法，严格 XML 解析会直接失败。
 * HTML 解析器容忍这些写法，之后再用 XMLSerializer 序列化即可得到合法 XML。
 */
function parseSvgElement(svg: string): SVGSVGElement | undefined {
  const parsedDocument = new DOMParser().parseFromString(svg, 'text/html');

  return parsedDocument.querySelector('svg') ?? undefined;
}

/**
 * 从 viewBox 读取尺寸，viewBox 缺失或非法时返回 undefined。
 */
function readViewBoxSize(svgElement: SVGSVGElement): SvgDimensions | undefined {
  const viewBox = svgElement
    .getAttribute('viewBox')
    ?.trim()
    .split(/\s+/)
    .map(value => Number(value));

  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    const width = viewBox[2];
    const height = viewBox[3];

    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  return undefined;
}

/**
 * 从 viewBox 或 width/height 中读取 SVG 原始尺寸。
 */
export function getSvgDimensions(svg: string): SvgDimensions | undefined {
  const svgElement = parseSvgElement(svg);

  if (!svgElement) {
    return undefined;
  }

  const viewBoxSize = readViewBoxSize(svgElement);

  if (viewBoxSize) {
    return viewBoxSize;
  }

  const width = parseSvgDimension(svgElement.getAttribute('width'));
  const height = parseSvgDimension(svgElement.getAttribute('height'));

  return width && height ? { width, height } : undefined;
}

/**
 * 解析 SVG 的数值尺寸，百分比尺寸不参与计算。
 */
function parseSvgDimension(value: string | null): number | undefined {
  if (!value || value.includes('%')) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * 解析 SVG 尺寸并转换为图片可直接加载的数据地址，解析不出 svg 元素时返回 undefined。
 */
function prepareSvgImageSource(svg: string): SvgImageSource | undefined {
  const svgElement = parseSvgElement(svg);

  if (!svgElement) {
    return undefined;
  }

  const viewBoxSize = readViewBoxSize(svgElement);

  if (viewBoxSize) {
    if (!svgElement.getAttribute('width') || svgElement.getAttribute('width')?.includes('%')) {
      svgElement.setAttribute('width', String(viewBoxSize.width));
    }
    if (!svgElement.getAttribute('height') || svgElement.getAttribute('height')?.includes('%')) {
      svgElement.setAttribute('height', String(viewBoxSize.height));
    }
  }

  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      new XMLSerializer().serializeToString(svgElement)
    )}`,
    width: viewBoxSize?.width,
    height: viewBoxSize?.height,
  };
}

/**
 * 将 SVG 转换为 PNG Blob。
 */
function svgToPngBlob(svg: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const imageSource = prepareSvgImageSource(svg);

    if (!imageSource) {
      reject(new Error('无法解析 SVG 内容'));
      return;
    }

    const image = new Image();

    image.onload = () => {
      const width = image.naturalWidth || imageSource.width;
      const height = image.naturalHeight || imageSource.height;

      if (!width || !height) {
        reject(new Error('无法获取 SVG 图片尺寸'));
        return;
      }

      const scale = Math.min(IMAGE_SCALE, MAX_CANVAS_SIZE / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));

      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('无法创建图片画布'));
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('无法生成 PNG 图片'));
      }, 'image/png');
    };

    image.onerror = () => reject(new Error('无法加载 SVG 图片'));
    image.src = imageSource.dataUrl;
  });
}

/**
 * 将 SVG 以 PNG 形式写入剪贴板。
 */
export async function copySvgImageToClipboard(svg: string): Promise<void> {
  const pngBlob = await svgToPngBlob(svg);

  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
}
