export const HOUR = 3600000;
export const TIME_OPTIONS = ['24小时', '12小时', '6小时', '3小时', '1小时'];
export const NOTIFY_OPTIONS = [...TIME_OPTIONS, '永不'];
export const USE_OPTIONS = [...TIME_OPTIONS, '永不使用'];
export const durationOf = value => TIME_OPTIONS.includes(value) ? Number.parseInt(value, 10) * HOUR : null;
export const settingsCapability = { readTool: 'settings.read', updateTool: 'settings.update' };
export const settingsSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    notifyBefore: { type: 'string', enum: NOTIFY_OPTIONS, title: '当剩余不足以下时长时通知我',
      description: '默认12小时。同次打开中同一卡片、同一提醒时长只通知一次；真正重开可再提醒。修改时长后按新阈值判断，后台重启不重复。' },
    useBefore: { type: 'string', enum: USE_OPTIONS, title: '当剩余不足以下时长时自动帮我使用',
      description: '默认永不使用。选择时长即授权进入该时段后自动尝试使用当前账号现有和后续卡片，成功后不再提醒。' },
  }, required: ['notifyBefore', 'useBefore'],
};
export const settingsLayout = [{ kind: 'group', title: '重置卡防过期提醒', items: [
  { kind: 'property', property: 'notifyBefore' }, { kind: 'property', property: 'useBefore' },
  { kind: 'tool', tool: 'reset_guard_open' },
] }];
export function validateSettings(set) {
  if (!set || typeof set !== 'object' || Array.isArray(set) || !Object.keys(set).length ||
      Object.entries(set).some(([key, value]) => !settingsSchema.properties[key]?.enum.includes(value))) {
    throw new Error('请选择允许的通知时长或自动使用时长');
  }
}
