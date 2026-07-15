from fastapi import FastAPI

# Initialize the FastAPI instance
app = FastAPI()

# Define a route using a decorator
@app.get("/")
def read_root():
    return {"message": "Hello, World!"}