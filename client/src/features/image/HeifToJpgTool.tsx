import ImageConvertTool from './ImageConvertTool';

export default function HeifToJpgTool() {
  return <ImageConvertTool toolId="heif-to-jpg" target="jpeg" kindLabel="HEIF image" transparentSource />;
}
