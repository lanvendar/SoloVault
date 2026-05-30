# SoloVault 实现任务拆解与接口清单

## 1. 实施目标

先实现一个可靠可用的 SoloVault PWA MVP。产品定位是一款轻量级、可离线、跨平台的个人密码管理器，目标平台包括 macOS、Windows、iOS 和 Android：

- 创建 / 解锁 vault
- 本地增删改查密码条目
- 搜索
- 导出 Vault 文件
- 导入 Vault 文件
- 自动锁定
- 批量文本编辑

暂缓：

- TOTP
- 高级密码生成策略
- KDF 参数迁移 UI
- 离线扫描导出 / 离线扫描导入

---

## 2. 推荐技术结构

前端建议使用普通 SPA 架构：

```txt
src/
  app/
    App.tsx
    routes.ts
  crypto/
    kdf.worker.ts
    kdf.ts
    vaultCrypto.ts
    encoding.ts
  storage/
    indexedDb.ts
    vaultStore.ts
  vault/
    schema.ts
    vaultService.ts
    importExport.ts
    bulkText.ts
  features/
    onboarding/
    unlock/
    entries/
    settings/
  shared/
    components/
    errors.ts
    time.ts
```

约束：

- `crypto/` 不依赖 UI
- `storage/` 不处理明文业务字段
- `vault/` 负责把加密、存储、schema 串起来
- UI 层只调用 `vaultService`

---

## 3. 数据类型

### 3.1 VaultFile

```ts
export type VaultFile = {
  version: 1;
  kdf: {
    algorithm: "pbkdf2-sha256" | "argon2id";
    params: Record<string, number>;
    saltPw: string;
    saltRec: string;
  };
  envelope: {
    dekByPassword: EncryptedBlob;
    dekByRecovery: EncryptedBlob;
  };
  payload: EncryptedBlob;
  meta: {
    createdAt: number;
    updatedAt: number;
  };
};

export type EncryptedBlob = {
  iv: string;
  ciphertext: string;
};
```

### 3.2 VaultPlain

```ts
export type VaultPlain = {
  entries: VaultEntry[];
};

export type VaultEntry = {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string | null;
  note: string | null;
  totpSecret: string | null;
  createdAt: number;
  updatedAt: number;
};
```

---

## 4. 核心接口

### 4.1 crypto/kdf.ts

```ts
export type KdfParams =
  | {
      algorithm: "pbkdf2-sha256";
      iterations: number;
    }
  | {
      algorithm: "argon2id";
      memoryKiB: number;
      iterations: number;
      parallelism: number;
    };

export async function deriveKey(
  secret: string,
  saltBase64: string,
  params: KdfParams
): Promise<CryptoKey>;
```

验收：

- KDF 必须跑在 Worker
- UI 线程不能明显卡顿
- 派生结果只返回不可导出的 `CryptoKey`

### 4.2 crypto/vaultCrypto.ts

```ts
export async function generateDek(): Promise<CryptoKey>;

export async function encryptJson(
  key: CryptoKey,
  value: unknown
): Promise<EncryptedBlob>;

export async function decryptJson<T>(
  key: CryptoKey,
  blob: EncryptedBlob
): Promise<T>;

export async function wrapDek(
  dek: CryptoKey,
  wrappingKey: CryptoKey
): Promise<EncryptedBlob>;

export async function unwrapDek(
  blob: EncryptedBlob,
  wrappingKey: CryptoKey
): Promise<CryptoKey>;
```

验收：

- 使用 `AES-GCM`
- 每次加密生成新 IV
- 解密失败统一抛 `VaultCryptoError`

### 4.3 storage/vaultStore.ts

```ts
export async function hasLocalVault(): Promise<boolean>;

export async function readLocalVault(): Promise<VaultFile | null>;

export async function writeLocalVault(vault: VaultFile): Promise<void>;

export async function clearLocalVault(): Promise<void>;
```

验收：

- IndexedDB 存储单个 `vault.current`
- 写入后可回读
- 清空操作需要 UI 二次确认，不在此层实现确认

### 4.4 vault/vaultService.ts

```ts
export async function createVault(input: {
  masterPassword: string;
}): Promise<{
  vaultFile: VaultFile;
  recoveryCode: string;
}>;

export async function unlockWithPassword(input: {
  masterPassword: string;
  vaultFile: VaultFile;
}): Promise<{
  dek: CryptoKey;
  plain: VaultPlain;
}>;

export async function resetPasswordWithRecovery(input: {
  recoveryCode: string;
  newMasterPassword: string;
  vaultFile: VaultFile;
}): Promise<VaultFile>;

export async function savePlainVault(input: {
  dek: CryptoKey;
  currentVaultFile: VaultFile;
  plain: VaultPlain;
}): Promise<VaultFile>;
```

验收：

- 密码错误不泄露内部细节
- recovery code 可重建主密码信封
- 保存条目时只更新 payload，不重建 DEK

### 4.5 vault/importExport.ts

```ts
export function serializeVault(vault: VaultFile): string;

export function parseVaultFile(text: string): VaultFile;

export function downloadVault(vault: VaultFile): void;
```

验收：

- 导出文件扩展名 `.vault`
- 导入时校验 JSON schema
- 版本不支持时给出明确错误

### 4.6 vault/bulkText.ts

```ts
export type BulkParseResult = {
  entries: VaultEntry[];
  errors: BulkParseError[];
};

export type BulkParseError = {
  blockIndex: number;
  field?: string;
  message: string;
};

export function entriesToBulkText(entries: VaultEntry[]): string;

export function parseBulkText(text: string): BulkParseResult;
```

验收：

- 空行分隔条目
- 支持 `title username password url note totpSecret`
- `username` 和 `password` 缺失时报错
- 不直接保存有错误的解析结果

---

## 5. UI 任务拆解

### 5.0 UI 基础规范

基础组件：

- `AppShell`
- `Button`
- `IconButton`
- `TextField`
- `PasswordField`
- `Modal`
- `Toast`
- `ConfirmDialog`
- `Toolbar`
- `EmptyState`

视觉约束：

- 页面背景 `#F7F8FA`
- 内容最大宽度 960px
- 移动端左右留白 16px
- 桌面端左右留白 24px
- 按钮、输入框、卡片圆角 8px
- 关键按钮高度不小于 44px
- 危险操作统一使用红色语义

图标约定：

- `导出 Vault 文件`: download
- `导入 Vault 文件`: upload
- `离线扫描导出`: qr-code
- `离线扫描导入`: scan-line
- `锁定`: lock
- `新增`: plus
- `复制`: copy
- `显示密码`: eye / eye-off
- `编辑`: pencil
- `删除`: trash

响应式验收：

- 360px 宽度不横向滚动
- 顶部工具栏允许换行
- 搜索框移动端独占一行
- 弹窗高度不超过视口，内容可滚动
- 卡片字段长文本必须省略或换行，不得撑破布局

### 5.1 初始化页

组件：

- `OnboardingPage`
- `CreateVaultForm`
- `ImportVaultPanel`
- `RecoveryCodePanel`

验收：

- 本地无 vault 时默认进入
- 创建成功后展示恢复码
- 用户勾选“已保存恢复码”后才能继续
- 导入成功后进入解锁页
- 主密码不一致时实时提示
- 创建中按钮显示 loading
- 恢复码使用等宽字体并按组分隔

### 5.2 解锁页

组件：

- `UnlockPage`
- `PasswordInput`
- `RecoveryResetModal`
- `DangerZoneModal`

验收：

- 本地有 vault 时默认进入
- 解锁成功进入主列表
- 解锁失败使用指数退避节流
- 清空本地数据必须输入 `WIPE`
- 回车触发解锁
- 节流倒计时期间解锁按钮禁用
- 清空本地数据入口位于底部危险区

### 5.3 主列表页

组件：

- `DashboardPage`
- `TopToolbar`
- `EntryCard`
- `EntryEditorModal`
- `BulkEditorModal`
- `ImportExportActions`

验收：

- 搜索匹配 title / username / url
- 密码默认隐藏
- 复制用户名 / 密码有 toast
- 删除条目需要二次确认
- 锁定后清空内存态并回到解锁页
- 工具栏包含 `导出 Vault 文件`、`离线扫描导出`、`导入 Vault 文件`、`离线扫描导入`
- 空状态展示 `新增条目` 和 `导入 Vault 文件`
- 搜索无结果时提供 `清空搜索`

### 5.4 条目卡片

组件：

- `EntryCard`
- `CopyButton`
- `PasswordRevealButton`
- `DeleteEntryDialog`

验收：

- 不做折叠展开
- 标题、用户名、密码行始终可见
- 密码默认以圆点或星号隐藏
- URL 和备注摘要长文本不撑破卡片
- 编辑和删除放在卡片右上或底部操作区
- 删除必须二次确认

### 5.5 新增/编辑弹窗

组件：

- `EntryEditorModal`
- `PasswordField`

验收：

- 字段顺序为标题、用户名、密码、网址、备注
- 用户名和密码为必填
- 保存成功后关闭弹窗并显示 toast
- 保存失败时保留用户输入
- 移动端弹窗内容可滚动

### 5.6 批量编辑

组件：

- `BulkEditorModal`
- `BulkPreviewTable`
- `BulkErrorList`

验收：

- 打开时由当前 entries 生成文本
- 点击解析后展示预览
- 有错误时禁用保存
- 保存采用整库替换，保存前提示会覆盖当前条目

### 5.7 Vault 文件导入导出

组件：

- `ExportVaultButton`
- `ImportVaultButton`
- `ImportConfirmDialog`

验收：

- 点击 `导出 Vault 文件` 直接下载 `.vault`
- 导出成功显示 toast
- 点击 `导入 Vault 文件` 打开文件选择器
- 导入前校验 schema
- 本地已有 vault 时必须覆盖确认
- 导入成功后跳转解锁页

### 5.8 离线扫描导出 / 离线扫描导入

组件：

- `OfflineScanExportModal`
- `OfflineScanImportModal`
- `QrFrameViewer`
- `QrScannerView`
- `ChunkProgress`

验收：

- `离线扫描导出` 展示 QR、当前分片、总分片数、整体校验摘要
- 默认不自动播放
- 支持上一张、下一张、自动播放
- `离线扫描导入` 展示摄像头预览和已接收进度
- 支持乱序扫码
- 重复分片不报错
- 全部分片接收后走 `导入 Vault 文件` 同一校验流程
- 摄像头权限被拒绝时给出可返回的错误态

---

## 6. 安全与体验细节

### 6.1 自动锁定

触发条件：

- 用户点击锁定
- 页面隐藏超过 5 分钟
- 15 分钟无交互

锁定动作：

- 清空明文 entries
- 清空 `dek`
- 停止所有剪贴板倒计时
- 回到解锁页

### 6.2 剪贴板

行为：

- 点击复制后显示 toast
- 30 秒后尝试写入空字符串
- 提供“立即清空剪贴板”

文案：

- “已复制，30 秒后尝试清空剪贴板”
- 不写“已安全清除”

### 6.3 错误文案

建议：

- 密码错误：`无法解锁，请检查主密码。`
- 导入格式错误：`文件格式不是有效的 SoloVault 备份。`
- 版本不支持：`当前应用暂不支持此备份版本。`
- 完整性校验失败：`备份无法解密或内容已损坏。`

---

## 7. 实施顺序

### 阶段 1：基础骨架

1. 建立 SPA 与路由
2. 建立 IndexedDB 存储
3. 建立 vault schema 校验
4. 建立基础 UI 组件

完成标准：

- 页面可在初始化 / 解锁 / 主列表之间跳转
- 能检测本地是否存在 vault

### 阶段 2：加密闭环

1. 实现 KDF Worker
2. 实现 DEK 生成与包裹
3. 实现 payload 加解密
4. 实现 create / unlock / save

完成标准：

- 创建 vault 后刷新页面仍可解锁
- 错误密码无法解锁

### 阶段 3：条目 CRUD

1. 列表展示
2. 新增
3. 编辑
4. 删除
5. 搜索

完成标准：

- 修改后刷新页面数据仍存在
- 必填字段校验正确

### 阶段 4：Vault 文件导入导出

1. 导出 Vault 文件
2. 导入 Vault 文件
3. 覆盖本地 vault 二次确认

完成标准：

- A 浏览器导出，B 浏览器导入后可解锁

### 阶段 5：批量编辑与体验加固

1. 批量文本解析
2. 解析预览
3. 自动锁定
4. 剪贴板 best effort 清理

完成标准：

- 错误输入能定位到条目
- 锁定后内存态不可继续访问

---

## 8. 测试清单

单元测试：

- `parseVaultFile`
- `parseBulkText`
- `entriesToBulkText`
- schema validation
- crypto encrypt/decrypt roundtrip

集成测试：

- 创建 vault -> 写入 IndexedDB -> 重新加载 -> 解锁
- 新增条目 -> 保存 -> 重新加载 -> 解锁后存在
- 错误密码 -> 解锁失败
- 恢复码 -> 重设主密码 -> 新密码可解锁
- 导出 -> 清空本地 -> 导入 -> 解锁成功

手工测试：

- 移动端窄屏布局
- PWA 离线加载
- 页面隐藏后自动锁定
- 剪贴板权限被拒绝

---

## 9. 后续版本预留

导出 Vault 文件：

- 导出完整加密后的 `VaultFile`
- 通过系统文件、聊天工具、网盘、AirDrop、U 盘等方式转移

导入 Vault 文件：

- 目标设备导入 `.vault` 后回到解锁页验证

离线扫描导出 / 离线扫描导入：

- 作为无文件传输条件下的辅助备份方式
- 离线扫描导出把完整加密后的 `VaultFile` 切成 QR 分片
- 离线扫描导入负责扫码、组装和校验
- 支持乱序扫码、分片校验、完整 payload hash 校验
- 组装成功后走同一套 `导入 Vault 文件` 校验流程
- 不做双向同步和冲突合并

TOTP：

- 初版字段已预留 `totpSecret`
- UI 可以后置
- 注意 TOTP secret 与密码同等敏感

KDF 迁移：

- 解锁成功后检测旧参数
- 用户确认后用新参数重包裹 DEK
- 不重新加密 payload

---

## 10. Agent 执行提示

实现时优先保证这三件事：

1. 数据不会因为普通操作丢失
2. 错误路径有清晰提示
3. 加密模块和 UI 分离

不要在 MVP 中实现：

- 本地失败次数自毁
- 自定义 HMAC 叠加完整性校验
- 复杂 WAL
- 双向同步
- 浏览器无法保证的“永久安全清除”
