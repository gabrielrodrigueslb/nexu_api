export const USER_ROLES = ["basic", "leader", "admin"];
export const USER_SECTORS = [
  "CS",
  "Comercial",
  "Financeiro",
  "Desenvolvimento",
  "Suporte",
  "Implantacao",
];

export const CATALOG_TYPES = ["PRODUCT", "INTEGRATION"];
export const DOC_TYPES = ["CPF", "CNPJ"];
export const LEAD_STATUSES = [
  "Leads",
  "Qualificados",
  "Oportunidade Futura",
  "Apresentacao",
  "No Show",
  "Em Negociacao",
  "Ganho",
  "Perdido",
];
export const LEAD_TASK_TYPES = [
  "reuniao",
  "ligacao",
  "whatsapp",
  "email",
  "demo",
  "follow",
  "visita",
  "outro",
];
export const TICKET_STATUSES = [
  "pendente_financeiro",
  "pagamento_confirmado",
  "em_implantacao",
  "concluido",
  "cancelado",
];
export const TICKET_TYPES = ["novo", "upsell", "renovacao"];
export const ACCESS_LEVELS = ["none", "view", "edit", "manage"];

export const LEGACY_ROLE_ALIASES = {
  agent: "basic",
  supervisor: "leader",
  basic: "basic",
  leader: "leader",
  admin: "admin",
};

export const MODULE_KEYS = [
  "DASHBOARD",
  "COMMERCIAL",
  "FINANCEIRO",
  "IMPLANTACAO",
  "SUPORTE",
  "DESENVOLVIMENTO",
  "CADASTROS",
  "USUARIOS",
  "LIXEIRA",
];

export const DEFAULT_MODULES = [
  {
    key: "DASHBOARD",
    name: "Dashboard",
    description: "Visao geral e indicadores",
    sortOrder: 10,
  },
  {
    key: "COMMERCIAL",
    name: "Comercial",
    description: "Leads, CRM e negociacoes",
    sortOrder: 20,
  },
  {
    key: "FINANCEIRO",
    name: "Financeiro",
    description: "Fluxo, cobranca e contratos",
    sortOrder: 30,
  },
  {
    key: "IMPLANTACAO",
    name: "Implantacao",
    description: "Tickets e acompanhamento de implantacao",
    sortOrder: 40,
  },
  {
    key: "SUPORTE",
    name: "Suporte",
    description: "Atendimento e operacao de suporte",
    sortOrder: 50,
  },
  {
    key: "DESENVOLVIMENTO",
    name: "Desenvolvimento",
    description: "Demandas e operacao tecnica",
    sortOrder: 60,
  },
  {
    key: "CADASTROS",
    name: "Cadastros",
    description: "Cadastros administrativos e configuracoes",
    sortOrder: 70,
  },
  {
    key: "USUARIOS",
    name: "Usuarios",
    description: "Gestao de usuarios, cargos e acessos",
    sortOrder: 80,
  },
  {
    key: "LIXEIRA",
    name: "Lixeira",
    description: "Itens excluidos com restauracao e exclusao permanente",
    sortOrder: 90,
  },
];

export const SYSTEM_PRESET_DEFINITIONS = [
  {
    slug: "basic-commercial-view",
    name: "Basico Comercial",
    description: "Visualizacao do modulo comercial",
    role: "basic",
    modulePermissions: [
      { moduleKey: "DASHBOARD", accessLevel: "view" },
      { moduleKey: "COMMERCIAL", accessLevel: "view" },
    ],
  },
  {
    slug: "basic-finance-view",
    name: "Basico Financeiro",
    description: "Visualizacao do modulo financeiro",
    role: "basic",
    modulePermissions: [
      { moduleKey: "DASHBOARD", accessLevel: "view" },
      { moduleKey: "FINANCEIRO", accessLevel: "view" },
    ],
  },
  {
    slug: "leader-commercial",
    name: "Lider Comercial",
    description: "Gerencia o modulo comercial e restaura itens da lixeira",
    role: "leader",
    modulePermissions: [
      { moduleKey: "DASHBOARD", accessLevel: "view" },
      { moduleKey: "COMMERCIAL", accessLevel: "manage" },
      { moduleKey: "LIXEIRA", accessLevel: "edit" },
    ],
  },
  {
    slug: "leader-finance",
    name: "Lider Financeiro",
    description: "Gerencia o modulo financeiro e restaura itens da lixeira",
    role: "leader",
    modulePermissions: [
      { moduleKey: "DASHBOARD", accessLevel: "view" },
      { moduleKey: "FINANCEIRO", accessLevel: "manage" },
      { moduleKey: "LIXEIRA", accessLevel: "edit" },
    ],
  },
  {
    slug: "leader-implantacao",
    name: "Lider Implantacao",
    description: "Gerencia implantacao e restaura itens da lixeira",
    role: "leader",
    modulePermissions: [
      { moduleKey: "DASHBOARD", accessLevel: "view" },
      { moduleKey: "IMPLANTACAO", accessLevel: "manage" },
      { moduleKey: "LIXEIRA", accessLevel: "edit" },
    ],
  },
  {
    slug: "leader-support",
    name: "Lider Suporte",
    description: "Gerencia suporte e restaura itens da lixeira",
    role: "leader",
    modulePermissions: [
      { moduleKey: "DASHBOARD", accessLevel: "view" },
      { moduleKey: "SUPORTE", accessLevel: "manage" },
      { moduleKey: "LIXEIRA", accessLevel: "edit" },
    ],
  },
  {
    slug: "leader-development",
    name: "Lider Desenvolvimento",
    description: "Gerencia desenvolvimento e restaura itens da lixeira",
    role: "leader",
    modulePermissions: [
      { moduleKey: "DASHBOARD", accessLevel: "view" },
      { moduleKey: "DESENVOLVIMENTO", accessLevel: "manage" },
      { moduleKey: "LIXEIRA", accessLevel: "edit" },
    ],
  },
];
