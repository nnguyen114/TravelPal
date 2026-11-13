"""Minimal stand-ins for Anthropic SDK responses."""

from types import SimpleNamespace as NS


def text(t):
    return NS(type="text", text=t)


def tool_use(id, name, input):
    return NS(type="tool_use", id=id, name=name, input=input)


def message(*content, stop_reason="end_turn"):
    return NS(content=list(content), stop_reason=stop_reason)


class FakeStream:
    def __init__(self, msg):
        self.msg = msg

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def __aiter__(self):
        async def gen():
            for b in self.msg.content:
                if b.type == "text":
                    yield NS(type="text", text=b.text)
        return gen()

    async def get_final_message(self):
        return self.msg


class FakeAsyncClient:
    """Each stream() call returns the next scripted message; records the kwargs."""

    def __init__(self, *messages, error=None):
        self.messages = list(messages)
        self.calls = []
        self.error = error
        self.beta = NS(messages=NS(stream=self.stream))

    def stream(self, **kw):
        self.calls.append(kw)
        if self.error:
            raise self.error
        return FakeStream(self.messages.pop(0))


class FakeClient:
    def __init__(self, *responses, error=None):
        self.responses = list(responses)
        self.calls = []
        self.error = error
        self.beta = NS(messages=NS(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        if self.error:
            raise self.error
        return self.responses.pop(0)
