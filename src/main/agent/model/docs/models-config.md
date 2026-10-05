# 模型配置（config.json.models）

## 用途

配置应用可用的 AI 服务商（provider）及其模型。Agent 运行时从中选择模型，并支持随时切换到任意一个已配置的模型。

## 文件位置

模型配置保存在用户数据目录下 data/config.json 的 models 字段。

## 配置示例

```json
{
  "models": {
    "default": { "provider": "deepseek", "model": "deepseek-chat" },
    "providers": {
      "deepseek": {
        "name": "DeepSeek",
        "baseUrl": "https://api.deepseek.com",
        "apiKey": "sk-xxxxxxxx",
        "models": [
          { "id": "deepseek-chat" },
          {
            "id": "deepseek-reasoner",
            "name": "DeepSeek Reasoner",
            "reasoning": true,
            "thinkingLevelMap": { "max": "high" },
            "contextWindow": 128000,
            "maxTokens": 8192
          }
        ]
      },
      "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "sk-yyyyyyyy",
        "models": [{ "id": "gpt-4o" }]
      }
    }
  }
}
```

## 字段说明

### 顶层

| 字段      | 类型   | 必填 | 说明                                |
| --------- | ------ | ---- | ----------------------------------- |
| providers | object | 是   | provider 集合，键名即 provider 标识 |
| default   | object | 否   | 启动时默认使用的模型                |

### default

| 字段     | 类型   | 必填 | 说明                                       |
| -------- | ------ | ---- | ------------------------------------------ |
| provider | string | 是   | provider 标识，需与 `providers` 的键名一致 |
| model    | string | 是   | 模型 id                                    |

### providers 中的每一项

| 字段    | 类型   | 必填 | 默认值             | 说明                               |
| ------- | ------ | ---- | ------------------ | ---------------------------------- |
| baseUrl | string | 是   | —                  | 接口地址                           |
| models  | array  | 是   | —                  | 该 provider 下的模型列表，至少一项 |
| apiKey  | string | 否   | —                  | 接口密钥                           |
| name    | string | 否   | provider 键名      | 显示名称                           |
| api     | string | 否   | openai-completions | 接口协议，见下节                   |

### models 中的每一项

| 字段             | 类型     | 必填 | 默认值   | 说明                                                                                                        |
| ---------------- | -------- | ---- | -------- | ----------------------------------------------------------------------------------------------------------- |
| id               | string   | 是   | —        | 模型标识，即请求时传给接口的 model 名                                                                       |
| name             | string   | 否   | 同 id    | 显示名称                                                                                                    |
| reasoning        | boolean  | 否   | false    | 是否支持深度思考                                                                                            |
| thinkingLevelMap | object   | 否   | —        | 思考级别到接口取值的对照表，见下节                                                                          |
| input            | string[] | 否   | ["text"] | 支持的输入类型，可选值 text、image。未声明 image 的模型收到图片时，图片会被替换为一段占位文本，请求不会报错 |
| contextWindow    | number   | 否   | 128000   | 上下文窗口大小（token）                                                                                     |
| maxTokens        | number   | 否   | 163840   | 单次最大输出（token）                                                                                       |
| api              | string   | 否   | —        | 覆盖 provider 级的 api                                                                                      |

## thinkingLevelMap

内核只认三档思考级别：`off`、`medium`、`max`，而各家接口的取值体系与之不同。这张对照表负责把内核的级别翻译成该模型接口接受的值，键只能是这三个：

| 键     | 含义                     |
| ------ | ------------------------ |
| off    | 明确要求不思考时下发的值 |
| medium | 中等思考                 |
| max    | 最强思考                 |

- 只写一部分键即可，没写的档位用适配器兜底值；写错键名会让整份配置判为非法。
- 模型不支持思考时省略整张表。

`openai-completions` 协议下，表里的值最终作为请求的 `reasoning_effort` 下发，未写到的档位兜底如下：

| 档位   | 兜底值   |
| ------ | -------- |
| off    | `none`   |
| medium | `medium` |
| max    | `max`    |

例：接口把最强档叫 `high`，写 `{ "max": "high" }`；接口的关闭开关叫 `none`，写 `{ "off": "none" }`；接口完全不认这个参数，整张表省略。

## api 取值

| 值                 | 说明                                                    |
| ------------------ | ------------------------------------------------------- |
| openai-completions | OpenAI 兼容接口，适用于 OpenAI、DeepSeek 及多数兼容服务 |

未显式指定时按 `openai-completions` 处理。

## 加载与校验

- ConfigService 在启动时读取 config.json，并为缺失字段补全默认值。
- JSON 损坏时，原文件会改名为 config.old.json，应用使用安全默认配置继续启动。
- 未知字段不参与当前 schema 校验，并在后续保存时继续保留。
- 模型配置的校验错误可通过 ModelRuntime.getError() 获取。
- 数值字段（contextWindow、maxTokens）必须大于 0，否则模型配置视为非法。
