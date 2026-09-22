export interface DesignSystem {
  project: string;
  vision: string;
  users: string;
  features: string[];
  pages: Array<{ name: string; description: string }>;
  flow: string[];
  uiux: string;
  colors: {
    primary?: string;
    secondary?: string;
    background?: string;
    surface?: string;
    card?: string;
    text?: string;
    mutedText?: string;
    border?: string;
    success?: string;
    warning?: string;
    error?: string;
  };
  typography: {
    font?: string;
    heading?: string;
    body?: string;
    headingWeights?: string;
    bodyWeight?: string;
  };
  layout: {
    maxWidth?: string;
    pageLayout?: string;
    sidebarWidth?: string;
    headerHeight?: string;
    contentPadding?: string;
  };
  grid: Record<string, string>;
  spacing: number[];
  radius: {
    button?: string;
    card?: string;
    inputs?: string;
  };
  shadows: string[];
  components: Array<{ name: string; description: string }>;
  responsive: Record<string, string>;
  animations: string[];
  icons?: string;
  images?: string;
  accessibility: string[];
  doNot: string[];
  frontend: {
    framework?: string;
    componentLibrary?: string;
  };
  backend: {
    framework?: string;
    apiStyle?: string;
  };
  database: {
    database?: string;
    entities?: string;
  };
  authentication?: string;
  security?: string;
  integrations?: string;
  acceptanceCriteria: string[];
  raw: string;
  parsedAt: string;
  warnings: string[];
}

export type DesignTheme = "light" | "dark" | "system" | "light+dark";

export interface DesignSystemJson {
  theme: DesignTheme;
  colors: Record<string, string>;
  layout: {
    type: string;
    sidebarWidth?: number;
    headerHeight?: number;
    maxWidth?: number;
  };
  typography: { font?: string };
  radius: { card?: number; button?: number };
  spacing: number[];
  components: Array<{ name: string; description: string }>;
  responsive: Record<string, string>;
  features: string[];
  pages: Array<{ name: string; description: string }>;
  warnings: string[];
  raw: string;
}